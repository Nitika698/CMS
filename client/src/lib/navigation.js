import {
  LayoutDashboard,
  Clapperboard,
  CalendarDays,
  Building2,
  Megaphone,
  CheckSquare,
  MessagesSquare,
  Wallet,
  Sparkles,
} from 'lucide-react';

/** Single source of truth for sidebar, routes and page titles. `phase` = planned delivery phase. */
export const NAV_ITEMS = [
  {
    path: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    phase: 'Roadmap P8',
    description: 'Your day at a glance: posts, deadlines and money owed.',
    planned: ['Today’s posts and tasks', 'Overdue items', 'Outstanding balance by currency', 'Recent communications'],
  },
  {
    path: '/content',
    label: 'Content',
    icon: Clapperboard,
    phase: 'Roadmap P2',
    description: 'Organise ideas, drafts and media in one library.',
    planned: ['Content items with status and categories', 'Cloud media uploads', 'Tags, search and filters'],
  },
  {
    path: '/calendar',
    label: 'Calendar',
    icon: CalendarDays,
    phase: 'Roadmap P3',
    description: 'Plan posts and see deadlines on one calendar.',
    planned: ['Month / week / agenda views', 'Drag to reschedule', 'Honest status: scheduled is a reminder until you confirm publishing'],
  },
  {
    path: '/brands',
    label: 'Brands',
    icon: Building2,
    phase: 'Roadmap P4',
    description: 'A CRM for the brands and agencies you work with.',
    planned: ['Brand and contact records', 'Per-brand history', 'Follow-up dates'],
  },
  {
    path: '/campaigns',
    label: 'Campaigns',
    icon: Megaphone,
    phase: 'Roadmap P5',
    description: 'Track brand deals, deliverables and approvals.',
    planned: ['Campaign briefs and fees', 'Deliverables with due dates', 'Linked content, tasks and invoices'],
  },
  {
    path: '/tasks',
    label: 'Tasks',
    icon: CheckSquare,
    phase: 'Roadmap P6',
    description: 'Never miss a deadline.',
    planned: ['Tasks with priorities', 'Reminders', 'Today / upcoming / overdue views'],
  },
  {
    path: '/communications',
    label: 'Communications',
    icon: MessagesSquare,
    phase: 'Roadmap P4',
    description: 'Keep a searchable history of every brand discussion.',
    planned: ['Manual log of emails, calls and DMs', 'Timeline per brand and campaign', 'One-click follow-up tasks'],
  },
  {
    path: '/payments',
    label: 'Payments',
    icon: Wallet,
    phase: 'Roadmap P7',
    description: 'Invoices, payments and outstanding balances.',
    planned: ['Invoices and line items', 'Partial payments', 'Outstanding balance per brand and currency'],
  },
  {
    path: '/ai',
    label: 'AI Assistant',
    icon: Sparkles,
    phase: 'Roadmap P9',
    description: 'Suggestions for captions, follow-ups and planning.',
    planned: ['Caption and hashtag ideas', 'Summaries of brand discussions', 'Draft follow-up messages'],
  },
];

export function findNavItem(pathname) {
  return NAV_ITEMS.find((i) => pathname === i.path || pathname.startsWith(`${i.path}/`));
}
