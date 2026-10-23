/** How campaign statuses are grouped. Used by the dashboard and by the client page so they always agree. */
export const ACTIVE_CAMPAIGN = ['confirmed', 'in_progress'];
export const PIPELINE_CAMPAIGN = ['proposed', 'negotiating'];
export const PAST_CAMPAIGN = ['delivered', 'completed'];
/** Statuses whose fee counts as "agreed" money. */
export const AGREED_CAMPAIGN = ['confirmed', 'in_progress', 'delivered', 'completed'];

export function campaignGroup(status) {
  if (ACTIVE_CAMPAIGN.includes(status)) return 'active';
  if (PIPELINE_CAMPAIGN.includes(status)) return 'pipeline';
  if (PAST_CAMPAIGN.includes(status)) return 'past';
  return 'cancelled';
}

// ------------------------------------------------------------------ campaign workflow

export const CAMPAIGN_STATUSES = ['proposed', 'negotiating', 'confirmed', 'in_progress', 'delivered', 'completed', 'cancelled'];
export const CAMPAIGN_STATUS_LABELS = {
  proposed: 'Proposed', negotiating: 'Negotiating', confirmed: 'Confirmed', in_progress: 'In progress',
  delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled',
};
/** Statuses where the work is over: no deadline warnings, no new deliverables. */
export const CLOSED_CAMPAIGN = ['completed', 'cancelled'];

/** Allowed moves. Everything not listed is refused. The guards (deliverables must be done) live in the service. */
export const CAMPAIGN_TRANSITIONS = {
  proposed: ['negotiating', 'confirmed', 'cancelled'],
  negotiating: ['proposed', 'confirmed', 'cancelled'],
  confirmed: ['in_progress', 'negotiating', 'cancelled'],
  in_progress: ['delivered', 'confirmed', 'cancelled'],
  delivered: ['completed', 'in_progress', 'cancelled'],
  completed: ['delivered'], // re-open
  cancelled: ['proposed'], // revive
};

// ------------------------------------------------------------------ deliverables

export const DELIVERABLE_STATUSES = ['pending', 'in_progress', 'completed', 'changes_requested', 'submitted', 'approved', 'delivered'];
export const DELIVERABLE_STATUS_LABELS = {
  pending: 'Planned', in_progress: 'In progress', completed: 'Completed', changes_requested: 'Changes requested',
  submitted: 'Awaiting approval', approved: 'Approved', delivered: 'Published',
};
/** Deliverables that still need work or a decision (the dashboard uses this too). */
export const OPEN_DELIVERABLE = ['pending', 'in_progress', 'completed', 'changes_requested', 'submitted'];
/** Not finished yet as far as the campaign deadline is concerned (approved work still has to be published/handed over). */
export const UNFINISHED_DELIVERABLE = [...OPEN_DELIVERABLE, 'approved'];

/** Position in the pipeline. Moving back clears the timestamps of later stages. */
export const DELIVERABLE_RANK = { pending: 0, in_progress: 1, changes_requested: 1, completed: 2, submitted: 3, approved: 4, delivered: 5 };
export const DELIVERABLE_STAMPS = { completed: 'completedAt', submitted: 'submittedAt', approved: 'approvedAt', delivered: 'deliveredAt' };

/** How much of a deliverable's journey is done. Progress = average of these over all deliverables; nothing is typed in by hand. */
export const DELIVERABLE_WEIGHTS = { pending: 0, in_progress: 20, changes_requested: 20, completed: 50, submitted: 65, approved: 85, delivered: 100 };

/** Where a deliverable can go next. Approval-required work must be submitted and approved before it is published. */
export function nextDeliverableStatuses(d) {
  const approval = d.requiresApproval !== false;
  switch (d.status) {
    case 'pending': return ['in_progress', 'completed'];
    case 'in_progress': return ['pending', 'completed'];
    case 'changes_requested': return ['in_progress', 'completed'];
    case 'completed': return ['in_progress', approval ? 'submitted' : 'delivered'];
    case 'submitted': return ['approved', 'changes_requested', 'completed'];
    case 'approved': return ['delivered', 'submitted'];
    default: return []; // delivered is final
  }
}

export const DEADLINE_WARN_DAYS = 7;

export const LIMITS = { objectives: 20, objectiveLen: 300, requirements: 30, quantity: 500, bulk: 50, title: 200, text: 20_000, shortText: 2_000, listMax: 1000 };
export const SORTS = ['deadline', 'endDate', 'startDate', 'title', 'updatedAt', 'createdAt', 'progress', 'status'];
export const ATTENTION_FILTERS = ['any', 'deadline_soon', 'overdue', 'incomplete'];
