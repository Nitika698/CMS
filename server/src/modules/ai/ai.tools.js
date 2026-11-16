import mongoose from 'mongoose';
import { z } from 'zod';
import { dayRange, formatLocal } from '../../lib/timezone.js';
import { Campaign } from '../campaigns/campaign.model.js';
import { listCampaigns } from '../campaigns/campaigns.service.js';
import { Client } from '../clients/client.model.js';
import { Communication } from '../communications/communication.model.js';
import { Content } from '../content/content.model.js';
import { money } from '../invoices/invoice.render.js';
import { listInvoices } from '../invoices/invoices.service.js';
import { listTasks } from '../tasks/tasks.service.js';

/**
 * Read-only tools the model may call to answer questions about the signed-in user's own data.
 *
 * PERMISSIONS ARE ENFORCED HERE, NOT BY THE MODEL:
 *   - `user` comes from the verified session. No tool has an owner, user or id parameter, so there is nothing for the
 *     model (or a prompt injected into its context) to point at someone else's records.
 *   - Arguments are validated and clamped by the schemas below; unknown arguments are rejected.
 *   - Every query runs through code that filters by the session user's id.
 *   - Results contain the minimum needed (titles, dates, amounts, statuses), are capped in rows and size, and never
 *     include contact details, payment instructions, tokens or other accounts' data.
 *   - No tool writes anything.
 */
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const limit = (max, def) => z.number().int().min(1).max(max).default(def);
const MAX_RESULT_CHARS = 6000;

const day = (d, tz) => (d ? formatLocal(d, tz).date : null);

const TOOLS = [
  {
    name: 'get_tasks',
    description: "List the user's tasks. Use for questions about what to do, what is overdue or due today.",
    input: z.object({ due: z.enum(['overdue', 'today', 'upcoming', 'none']).optional(), include: z.enum(['open', 'done', 'all']).default('open'), limit: limit(20, 15) }).strict(),
    inputSchema: {
      type: 'object',
      properties: {
        due: { type: 'string', enum: ['overdue', 'today', 'upcoming', 'none'], description: 'Only tasks in this due bucket' },
        include: { type: 'string', enum: ['open', 'done', 'all'], description: 'Default open' },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
    },
    async run(user, a) {
      const q = { archived: false, sort: 'due', page: 1, limit: a.limit, ...(a.due && { due: a.due }), ...(a.include === 'open' && { open: 'true' }), ...(a.include === 'done' && { status: ['done'] }) };
      const r = await listTasks(user, q);
      return {
        total: r.meta.total,
        tasks: r.data.map((t) => ({ title: t.title, status: t.statusLabel, priority: t.priorityLabel, due: t.dueDate ? `${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''}` : null, overdue: t.overdue, campaign: t.links.campaign?.title ?? null, brand: t.links.client?.name ?? null })),
      };
    },
  },
  {
    name: 'get_upcoming_deadlines',
    description: 'Deadlines coming up: task due dates, content deadlines, campaign deadlines and invoice due dates, soonest first.',
    input: z.object({ days: z.number().int().min(1).max(60).default(14) }).strict(),
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 60, description: 'How many days ahead, default 14' } } },
    async run(user, a, now) {
      const tz = user.timezone || 'UTC';
      const start = dayRange(now, tz).start;
      const end = new Date(dayRange(new Date(now.getTime() + a.days * 86_400_000), tz).end);
      const owner = oid(user.id);
      const [tasks, content, campaigns, invoices] = await Promise.all([
        listTasks(user, { archived: false, open: 'true', sort: 'due', page: 1, limit: 100 }, now),
        Content.find({ owner, archivedAt: null, status: { $nin: ['approved', 'published'] }, deadline: { $gte: start, $lt: end } }).select('title deadline status').sort({ deadline: 1 }).limit(20).lean(),
        Campaign.find({ owner, archivedAt: null, status: { $in: ['proposed', 'negotiating', 'confirmed', 'in_progress'] }, deadline: { $gte: start, $lt: end } }).select('title deadline status').sort({ deadline: 1 }).limit(20).lean(),
        listInvoices(user, { status: ['sent', 'partially_paid', 'overdue'], dueFrom: day(start, tz), dueTo: day(end, tz), sort: 'dueDate', page: 1, limit: 20 }, now),
      ]);
      const items = [
        ...tasks.data.filter((t) => t.dueDate && t.daysUntilDue >= 0 && t.daysUntilDue <= a.days).map((t) => ({ kind: 'task', title: t.title, date: t.dueDate, note: t.priorityLabel })),
        ...content.map((c) => ({ kind: 'content deadline', title: c.title, date: day(c.deadline, tz), note: c.status })),
        ...campaigns.map((c) => ({ kind: 'campaign deadline', title: c.title, date: day(c.deadline, tz), note: c.status })),
        ...invoices.data.map((i) => ({ kind: 'invoice due', title: `${i.number} (${i.client.name})`, date: i.dueDay, note: `${money(i.balanceMinor, i.currency)} still owed` })),
      ];
      items.sort((x, y) => String(x.date).localeCompare(String(y.date)));
      return { from: day(start, tz), days: a.days, count: items.length, items: items.slice(0, 25) };
    },
  },
  {
    name: 'get_outstanding_invoices',
    description: 'Invoices that have been issued and are not fully paid, with the amount still owed. Amounts are already formatted; do not recalculate them.',
    input: z.object({ overdueOnly: z.boolean().default(false), limit: limit(20, 15) }).strict(),
    inputSchema: { type: 'object', properties: { overdueOnly: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 20 } } },
    async run(user, a, now) {
      const r = await listInvoices(user, { status: a.overdueOnly ? ['overdue'] : ['sent', 'partially_paid', 'overdue'], sort: 'dueDate', page: 1, limit: a.limit }, now);
      return {
        totalsByCurrency: r.meta.totals.map((t) => ({ currency: t.currency, stillOwed: money(t.outstanding, t.currency), ofWhichOverdue: money(t.overdue, t.currency) })),
        matchingInvoices: r.meta.total,
        invoices: r.data.map((i) => ({ number: i.number, brand: i.client.name, campaign: i.campaign?.title ?? null, status: i.displayLabel, due: i.dueDay, daysOverdue: i.overdueDays || undefined, total: money(i.totalMinor, i.currency), paid: money(i.paidMinor, i.currency), stillOwed: money(i.balanceMinor, i.currency) })),
      };
    },
  },
  {
    name: 'get_campaigns',
    description: "The user's campaigns with brand, stage, deadline and progress (progress is calculated from deliverables).",
    input: z.object({ activeOnly: z.boolean().default(true), limit: limit(15, 10) }).strict(),
    inputSchema: { type: 'object', properties: { activeOnly: { type: 'boolean', description: 'Default true: confirmed and in progress only' }, limit: { type: 'integer', minimum: 1, maximum: 15 } } },
    async run(user, a, now) {
      const r = await listCampaigns(user, { archived: false, sort: 'deadline', page: 1, limit: a.limit, ...(a.activeOnly && { status: ['confirmed', 'in_progress'] }) }, now);
      return {
        total: r.meta.total,
        campaigns: r.data.map((c) => ({ title: c.title, brand: c.client.name, stage: c.statusLabel, deadline: c.local.deadline, progressPercent: c.progress.percent, warnings: c.flags.filter((f) => f.severity !== 'info').slice(0, 3).map((f) => f.message ?? f.code) })),
      };
    },
  },
  {
    name: 'get_recent_communications',
    description: 'The most recent saved discussions with brands (the user logs these by hand). Optionally for one brand, matched by name.',
    input: z.object({ brand: z.string().trim().min(1).max(100).optional(), limit: limit(8, 5) }).strict(),
    inputSchema: { type: 'object', properties: { brand: { type: 'string', description: 'Brand name (partial match)' }, limit: { type: 'integer', minimum: 1, maximum: 8 } } },
    async run(user, a, now) {
      const tz = user.timezone || 'UTC';
      const owner = oid(user.id);
      let clientIds = null;
      if (a.brand) {
        const rx = new RegExp(a.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        clientIds = (await Client.find({ owner, name: rx }).select('_id').limit(10).lean()).map((c) => c._id);
      }
      const rows = await Communication.find({ owner, archivedAt: null, occurredAt: { $lte: now }, ...(clientIds && { client: { $in: clientIds } }) }).sort({ occurredAt: -1 }).limit(a.limit).lean();
      const names = new Map((await Client.find({ owner, _id: { $in: rows.map((r) => r.client) } }).select('name').lean()).map((c) => [String(c._id), c.name]));
      return {
        discussions: rows.map((r) => ({ brand: names.get(String(r.client)) ?? null, when: day(r.occurredAt, tz), channel: r.channel, direction: r.direction, subject: r.subject ?? null, snippet: (r.body ?? '').slice(0, 200) || null })),
      };
    },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);
export const toolDefinitions = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

/**
 * Runs a tool for the session user. Returns { content, summary } where `content` is the text given back to the model.
 * Unknown tools and bad arguments come back as an error message to the model; they never throw to the user.
 */
export async function runTool(user, name, rawInput, now = new Date()) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: JSON.stringify({ error: `Unknown tool "${name}". Available: ${TOOL_NAMES.join(', ')}` }), summary: { tool: name, ok: false } };
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { content: JSON.stringify({ error: 'Invalid arguments', details: parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).slice(0, 5) }), summary: { tool: name, ok: false } };
  }
  try {
    const result = await tool.run(user, parsed.data, now);
    let content = JSON.stringify(result);
    if (content.length > MAX_RESULT_CHARS) content = `${content.slice(0, MAX_RESULT_CHARS)}…[truncated]`;
    return { content, summary: { tool: name, ok: true, args: parsed.data } };
  } catch {
    return { content: JSON.stringify({ error: 'Could not load that data right now.' }), summary: { tool: name, ok: false } };
  }
}
