import { formatLocal } from '../../lib/timezone.js';
import { CLOSED_CAMPAIGN, DEADLINE_WARN_DAYS, DELIVERABLE_STATUSES, DELIVERABLE_WEIGHTS, OPEN_DELIVERABLE, UNFINISHED_DELIVERABLE } from './campaign.constants.js';

/**
 * Pure functions: progress and warnings are DERIVED from deliverable states and dates every time, never stored.
 * Dates are compared as calendar days in the user's timezone.
 */

const DAY = 86_400_000;
const dayNumber = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
};
/** Whole days from today to `date` in the user's timezone: 0 = today, -1 = yesterday. null when there is no date. */
export function daysUntil(date, now, tz) {
  return date ? dayNumber(formatLocal(date, tz).date) - dayNumber(formatLocal(now, tz).date) : null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function progressOf(deliverables) {
  const counts = Object.fromEntries(DELIVERABLE_STATUSES.map((s) => [s, 0]));
  let score = 0;
  for (const d of deliverables) {
    counts[d.status] += 1;
    score += DELIVERABLE_WEIGHTS[d.status] ?? 0;
  }
  const total = deliverables.length;
  return {
    total,
    percent: total ? Math.round(score / total) : 0,
    counts,
    // What is only planned, what is finished, what the brand has signed off, and what is live.
    stages: {
      planned: counts.pending + counts.in_progress + counts.changes_requested,
      completed: counts.completed + counts.submitted,
      approved: counts.approved,
      published: counts.delivered,
    },
  };
}

/** For each thing the brand asked for: how many deliverables are planned, approved and published. */
export function coverageOf(requirements, deliverables) {
  return requirements.map((r) => {
    const mine = deliverables.filter((d) => d.platform === r.platform && d.format === r.format);
    return {
      id: String(r._id), platform: r.platform, format: r.format, quantity: r.quantity,
      planned: mine.length,
      approved: mine.filter((d) => ['approved', 'delivered'].includes(d.status)).length,
      published: mine.filter((d) => d.status === 'delivered').length,
      missing: Math.max(0, r.quantity - mine.length),
    };
  });
}

/** Warnings for one deliverable. `campaign` supplies the deadline it must respect. */
export function deliverableFlags(d, campaign, now, tz) {
  const flags = [];
  if (campaign && (CLOSED_CAMPAIGN.includes(campaign.status) || campaign.archivedAt)) return flags;
  const days = daysUntil(d.dueDate, now, tz);
  if (OPEN_DELIVERABLE.includes(d.status) && days !== null) {
    if (days < 0) flags.push({ code: 'overdue', severity: 'danger', message: `${plural(-days, 'day', 'days')} overdue` });
    else if (days <= DEADLINE_WARN_DAYS) flags.push({ code: 'due_soon', severity: 'warning', message: days === 0 ? 'Due today' : `Due in ${plural(days, 'day', 'days')}` });
  }
  if (d.dueDate && campaign?.deadline && UNFINISHED_DELIVERABLE.includes(d.status) && daysUntil(d.dueDate, campaign.deadline, tz) > 0) {
    flags.push({ code: 'after_campaign_deadline', severity: 'warning', message: 'Due after the campaign deadline' });
  }
  if (d.status === 'submitted') flags.push({ code: 'awaiting_approval', severity: 'info', message: 'Waiting for the brand to approve' });
  if (d.status === 'changes_requested') flags.push({ code: 'changes_requested', severity: 'warning', message: 'The brand asked for changes' });
  return flags;
}

/**
 * Warnings for a campaign. `deliverables` carry their own `flags` (see deliverableFlags).
 * A closed (completed/cancelled) or archived campaign raises none.
 */
export function campaignFlags(campaign, deliverables, coverage, now, tz) {
  const flags = [];
  if (campaign.archivedAt || CLOSED_CAMPAIGN.includes(campaign.status)) return flags;

  const unfinished = deliverables.filter((d) => UNFINISHED_DELIVERABLE.includes(d.status)).length;
  const deadlineDays = daysUntil(campaign.deadline, now, tz);
  const endDays = daysUntil(campaign.endDate, now, tz);
  const working = ['confirmed', 'in_progress'].includes(campaign.status);

  // Once the work has been handed over, the deadline has been met.
  if (campaign.status !== 'delivered' && deadlineDays !== null) {
    if (deadlineDays < 0) flags.push({ code: 'deadline_overdue', severity: 'danger', message: `Deadline passed ${plural(-deadlineDays, 'day', 'days')} ago` });
    else if (deadlineDays <= DEADLINE_WARN_DAYS) flags.push({ code: 'deadline_soon', severity: 'warning', message: deadlineDays === 0 ? 'Deadline is today' : `Deadline in ${plural(deadlineDays, 'day', 'days')}` });
  }
  if (working && endDays !== null && endDays < 0) {
    flags.push({ code: 'past_end_date', severity: 'warning', message: 'The end date has passed but the campaign is not marked delivered' });
  }

  const overdue = deliverables.filter((d) => d.flags?.some((f) => f.code === 'overdue')).length;
  if (overdue) flags.push({ code: 'deliverables_overdue', severity: 'danger', count: overdue, message: `${plural(overdue, 'deliverable is', 'deliverables are')} overdue` });
  const soon = deliverables.filter((d) => d.flags?.some((f) => f.code === 'due_soon')).length;
  if (soon) flags.push({ code: 'deliverables_due_soon', severity: 'warning', count: soon, message: `${plural(soon, 'deliverable is', 'deliverables are')} due within ${DEADLINE_WARN_DAYS} days` });

  // Incomplete: work is still open while the deadline is close or past, or the campaign claims to be further along than its deliverables.
  const nearDeadline = (deadlineDays !== null && deadlineDays <= DEADLINE_WARN_DAYS) || (endDays !== null && endDays < 0);
  if (unfinished && (campaign.status === 'delivered' || (working && nearDeadline))) {
    const late = (deadlineDays !== null && deadlineDays < 0) || (endDays !== null && endDays < 0);
    flags.push({ code: 'incomplete_deliverables', severity: late ? 'danger' : 'warning', count: unfinished, message: `${plural(unfinished, 'deliverable is', 'deliverables are')} not finished yet` });
  }
  if (working) {
    const missing = coverage.reduce((n, c) => n + c.missing, 0);
    if (missing) flags.push({ code: 'requirements_unplanned', severity: 'warning', count: missing, message: `${plural(missing, 'requested piece has', 'requested pieces have')} no deliverable yet` });
    if (campaign.status === 'in_progress' && !deliverables.length && !campaign.requirements?.length) flags.push({ code: 'no_deliverables', severity: 'info', message: 'No deliverables have been added' });
  }
  return flags;
}

export const topSeverity = (flags) => (flags.some((f) => f.severity === 'danger') ? 'danger' : flags.some((f) => f.severity === 'warning') ? 'warning' : flags.length ? 'info' : null);
