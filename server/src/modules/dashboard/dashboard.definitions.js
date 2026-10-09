/**
 * The single source of truth for what every dashboard number MEANS. Sent to the client with each response
 * so the UI labels never drift from the calculation.
 *   kind:   'count' (number of records) | 'amount' (money in minor units, per currency) | 'duration' (days)
 *   period: the time window the number covers
 */
export const UPCOMING_DAYS = 14;

export const DEFINITIONS = {
  contentPipeline: {
    kind: 'count',
    period: 'snapshot (now)',
    text: 'Non-archived content items by stage. A content item counts once, in its furthest stage: Published (has a post confirmed as published) > Scheduled (has a post scheduled or awaiting confirmation) > its own stage (Idea, Drafting, Ready).',
  },
  upcomingPosts: {
    kind: 'count',
    period: `next ${UPCOMING_DAYS} days`,
    text: `Posts with status "scheduled" and a scheduled time from now up to ${UPCOMING_DAYS} days ahead. "Scheduled" is an internal reminder: it does not mean a platform will publish. "Needs confirmation" counts posts awaiting your confirmation or scheduled in the past and not yet confirmed.`,
  },
  activeCampaigns: {
    kind: 'count',
    period: 'snapshot (now)',
    text: 'Non-archived campaigns with status Confirmed or In progress.',
  },
  deadlines: {
    kind: 'count',
    period: `next ${UPCOMING_DAYS} days`,
    text: `Campaign end dates and open deliverable due dates (not approved/delivered) from the start of today up to ${UPCOMING_DAYS} days ahead, for campaigns that are not archived, cancelled or completed. "Overdue" items are due before today.`,
  },
  tasksDueToday: {
    kind: 'count',
    period: 'today (your timezone)',
    text: 'Open tasks (To do / Doing) due at any time during today, in your profile timezone.',
  },
  tasksOverdue: {
    kind: 'count',
    period: 'before today (your timezone)',
    text: 'Open tasks whose due time is before the start of today. Tasks due earlier today count as "due today", never both.',
  },
  pendingReviews: {
    kind: 'count',
    period: 'snapshot (now)',
    text: 'Deliverables that need approval and have been submitted to the client, still awaiting their review.',
  },
  payments: {
    kind: 'amount',
    period: 'all time (collected this month shown separately)',
    text:
      'Per currency; currencies are never added together. Agreed = fees of Confirmed/In progress/Delivered/Completed campaigns. ' +
      'Invoiced = total of invoices marked Sent. Collected = payments received against Sent invoices. ' +
      'Outstanding = invoiced minus collected, per invoice, never below zero. Overdue = outstanding on invoices past their due date. ' +
      'Not yet invoiced = agreed minus invoiced, never below zero.',
  },
  recentActivity: {
    kind: 'count',
    period: 'latest 8 events',
    text: 'The most recent logged communications and payments received, newest first. Only events dated now or earlier.',
  },
};
