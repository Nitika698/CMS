/**
 * Which product modules have working create/edit features yet.
 *
 * The dashboard reports a section as "unavailable" (not "0") while its module is false, because showing
 * "0 overdue tasks" for a module that cannot hold tasks yet would be a made-up metric.
 * Flip a flag to `true` in the same change that ships that module's CRUD.
 */
export const MODULES = {
  content: { ready: true, phase: 'Roadmap P2', label: 'Content' },
  calendar: { ready: true, phase: 'Roadmap P3', label: 'Calendar' },
  crm: { ready: true, phase: 'Roadmap P4', label: 'Brands & communications' },
  campaigns: { ready: true, phase: 'Roadmap P5', label: 'Campaigns' },
  tasks: { ready: true, phase: 'Roadmap P6', label: 'Tasks' },
  payments: { ready: true, phase: 'Roadmap P7', label: 'Payments' },
};
