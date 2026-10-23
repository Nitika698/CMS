import mongoose from 'mongoose';
import { MODULES } from '../../config/modules.js';
import { dayRange, monthRange, zonedYmd } from '../../lib/timezone.js';
import { Content } from '../content/content.model.js';
import { STATUSES, STATUS_LABELS } from '../content/content.constants.js';
import { Post } from '../posts/post.model.js';
import { Client } from '../clients/client.model.js';
import { Campaign } from '../campaigns/campaign.model.js';
import { ACTIVE_CAMPAIGN, OPEN_DELIVERABLE } from '../campaigns/campaign.constants.js';
import { Deliverable } from '../campaigns/deliverable.model.js';
import { bucketTasks } from '../tasks/tasks.service.js';
import { Communication } from '../communications/communication.model.js';
import { Invoice } from '../invoices/invoice.model.js';
import { Payment } from '../invoices/payment.model.js';
import { agreedByCurrency, invoiceTotals } from '../invoices/invoice.aggregates.js';
import { DEFINITIONS, UPCOMING_DAYS } from './dashboard.definitions.js';

const DAY = 24 * 60 * 60 * 1000;
const LIST = 6;
const FINISHED_CAMPAIGN = ['cancelled', 'completed'];

const id = (v) => (v ? String(v) : null);

// EVERY query below filters by ctx.owner. Referenced documents (clients, campaigns, ...) are looked up with
// the same owner filter too, so a bad reference could never leak another user's names.
const owned = (ctx, extra = {}) => ({ owner: ctx.owner, ...extra });

async function clientNames(ctx, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const rows = await Client.find(owned(ctx, { _id: { $in: unique } })).select('name').lean();
  return new Map(rows.map((c) => [String(c._id), c.name]));
}

/** Campaigns that still matter: not archived, not cancelled, not completed. Memoised per request. */
function liveCampaignIds(ctx) {
  ctx._live ??= Campaign.find(owned(ctx, { archivedAt: null, status: { $nin: FINISHED_CAMPAIGN } }))
    .select('_id')
    .lean()
    .then((rows) => rows.map((r) => r._id));
  return ctx._live;
}

/** Whole calendar days from today (in the user's timezone) to `date`. 0 = today, -1 = yesterday. */
function daysFromToday(ctx, date) {
  const a = zonedYmd(ctx.now, ctx.tz);
  const b = zonedYmd(date, ctx.tz);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY);
}

// ---------------------------------------------------------------- sections

async function contentPipeline(ctx) {
  // One count per workflow status (non-archived items). "Published" is a status the user declares; scheduled-but-unpublished
  // content stays in its own stage, so this never claims something is live when it is only planned.
  const rows = await Content.aggregate([{ $match: owned(ctx, { archivedAt: null }) }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const counts = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const stages = STATUSES.map((key) => ({ key, label: STATUS_LABELS[key], count: counts[key] ?? 0 }));
  return { stages, total: stages.reduce((sum, x) => sum + x.count, 0), note: null };
}

async function upcomingPosts(ctx) {
  const where = owned(ctx, { status: 'scheduled', scheduledAt: { $gte: ctx.now, $lt: ctx.horizon } });
  const [count, rows, needsConfirmation] = await Promise.all([
    Post.countDocuments(where),
    Post.find(where).sort({ scheduledAt: 1 }).limit(LIST).populate({ path: 'content', select: 'title', match: { owner: ctx.owner } }).lean(),
    Post.countDocuments(
      owned(ctx, { $or: [{ status: 'awaiting_confirmation' }, { status: 'scheduled', scheduledAt: { $lt: ctx.now } }] }),
    ),
  ]);
  return {
    windowDays: UPCOMING_DAYS,
    count,
    needsConfirmation,
    items: rows.map((p) => ({
      id: id(p._id),
      contentId: id(p.content?._id),
      contentTitle: p.content?.title ?? 'Untitled content',
      platform: p.platform,
      scheduledAt: p.scheduledAt,
      status: p.status, // "scheduled" = internal reminder only
    })),
  };
}

async function campaigns(ctx) {
  const activeWhere = owned(ctx, { archivedAt: null, status: { $in: ACTIVE_CAMPAIGN } });
  const live = await liveCampaignIds(ctx);
  const dueWindow = owned(ctx, { campaign: { $in: live }, status: { $in: OPEN_DELIVERABLE }, dueDate: { $gte: ctx.today.start, $lt: ctx.horizon } });
  const [activeCount, activeRows, deliverables, dueWindowCount, overdueDeliverables, pastEnd] = await Promise.all([
    Campaign.countDocuments(activeWhere),
    Campaign.find(activeWhere).limit(200).lean(),
    Deliverable.find(dueWindow).sort({ dueDate: 1 }).limit(50).lean(),
    Deliverable.countDocuments(dueWindow),
    Deliverable.countDocuments(owned(ctx, { campaign: { $in: live }, status: { $in: OPEN_DELIVERABLE }, dueDate: { $lt: ctx.today.start } })),
    Campaign.countDocuments({ ...activeWhere, endDate: { $lt: ctx.today.start } }),
  ]);

  // Campaigns without an end date sort last.
  activeRows.sort((a, b) => (a.endDate?.getTime() ?? Infinity) - (b.endDate?.getTime() ?? Infinity));

  const campaignIds = [...activeRows.map((c) => c._id), ...deliverables.map((d) => d.campaign)];
  const campaignRows = await Campaign.find(owned(ctx, { _id: { $in: campaignIds } })).select('title client').lean();
  const campaignById = new Map(campaignRows.map((c) => [String(c._id), c]));
  const names = await clientNames(ctx, [...activeRows.map((c) => c.client), ...campaignRows.map((c) => c.client)]);

  const endingAll = activeRows.filter((c) => c.endDate && c.endDate >= ctx.today.start && c.endDate < ctx.horizon);
  const endingSoon = endingAll
    .map((c) => ({ type: 'campaign_end', id: id(c._id), title: c.title, campaignId: id(c._id), clientName: names.get(String(c.client)) ?? null, dueAt: c.endDate }));
  const dueDeliverables = deliverables.map((d) => {
    const camp = campaignById.get(String(d.campaign));
    return { type: 'deliverable', id: id(d._id), title: d.title, campaignId: id(d.campaign), campaignTitle: camp?.title ?? null, clientName: names.get(String(camp?.client)) ?? null, dueAt: d.dueDate };
  });
  const deadlines = [...endingSoon, ...dueDeliverables]
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, 8)
    .map((d) => ({ ...d, daysLeft: daysFromToday(ctx, d.dueAt) }));

  return {
    windowDays: UPCOMING_DAYS,
    activeCount,
    active: activeRows.slice(0, LIST).map((c) => ({
      id: id(c._id), title: c.title, status: c.status, clientId: id(c.client), clientName: names.get(String(c.client)) ?? null, endDate: c.endDate ?? null,
    })),
    deadlines,
    deadlineCount: endingAll.length + dueWindowCount,
    overdue: { deliverables: overdueDeliverables, campaignsPastEndDate: pastEnd },
  };
}

async function tasks(ctx) {
  // Same buckets as the tasks page (task.logic.js): a task is in exactly one of overdue / due today / upcoming.
  const shape = (t) => ({ id: id(t._id), title: t.title, dueAt: t.dueAt, dueHasTime: !!t.dueHasTime, priority: t.priority, status: t.status, campaignId: id(t.links?.campaign) });
  const b = await bucketTasks({ owner: ctx.owner, tz: ctx.tz, now: ctx.now }, { limit: LIST, shape });
  return {
    dueTodayCount: b.today.count,
    overdueCount: b.overdue.count,
    upcomingCount: b.upcoming.count,
    dueToday: b.today.rows,
    overdue: b.overdue.rows,
    upcoming: b.upcoming.rows,
  };
}

async function reviews(ctx) {
  const live = await liveCampaignIds(ctx);
  const where = owned(ctx, { campaign: { $in: live }, status: 'submitted', requiresApproval: true });
  const [count, rows] = await Promise.all([Deliverable.countDocuments(where), Deliverable.find(where).sort({ submittedAt: 1, updatedAt: 1 }).limit(8).lean()]);
  const camps = await Campaign.find(owned(ctx, { _id: { $in: rows.map((r) => r.campaign) } })).select('title client').lean();
  const campById = new Map(camps.map((c) => [String(c._id), c]));
  const names = await clientNames(ctx, camps.map((c) => c.client));
  return {
    count,
    items: rows.map((d) => {
      const camp = campById.get(String(d.campaign));
      const since = d.submittedAt ?? d.updatedAt;
      return {
        id: id(d._id), title: d.title, campaignId: id(d.campaign), campaignTitle: camp?.title ?? null,
        clientId: id(camp?.client), clientName: names.get(String(camp?.client)) ?? null,
        submittedAt: since, waitingDays: Math.max(0, Math.floor((ctx.now - since) / DAY)),
      };
    }),
  };
}

async function payments(ctx) {
  // The agreed / invoiced / collected / outstanding rules live in ONE place, shared with the client page.
  const [agreedRows, invoiceRows, monthRows] = await Promise.all([
    agreedByCurrency(ctx.owner),
    invoiceTotals(ctx.owner, ctx.today.start),
    Payment.aggregate([
      { $match: owned(ctx, { paidAt: { $gte: ctx.month.start, $lt: ctx.month.end } }) },
      { $lookup: { from: Invoice.collection.name, localField: 'invoice', foreignField: '_id', as: 'inv' } },
      { $match: { 'inv.owner': ctx.owner, 'inv.status': 'sent' } },
      { $group: { _id: '$currency', collectedThisMonth: { $sum: '$amountMinor' } } },
    ]),
  ]);

  const byCurrency = new Map();
  const slot = (c) => {
    if (!byCurrency.has(c)) byCurrency.set(c, { currency: c, agreed: 0, invoiced: 0, collected: 0, outstanding: 0, overdue: 0, openInvoices: 0, collectedThisMonth: 0 });
    return byCurrency.get(c);
  };
  for (const r of agreedRows) if (r._id) slot(r._id).agreed = r.agreed;
  for (const r of invoiceRows) Object.assign(slot(r._id), { invoiced: r.invoiced, collected: r.collected, outstanding: r.outstanding, overdue: r.overdue, openInvoices: r.openInvoices });
  for (const r of monthRows) slot(r._id).collectedThisMonth = r.collectedThisMonth;

  const currencies = [...byCurrency.values()]
    .map((c) => ({ ...c, notYetInvoiced: Math.max(0, c.agreed - c.invoiced) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return { currencies };
}

async function recentActivity(ctx) {
  const withPayments = ctx.modules.payments.ready;
  const [comms, pays] = await Promise.all([
    Communication.find(owned(ctx, { archivedAt: null, occurredAt: { $lte: ctx.now } })).sort({ occurredAt: -1 }).limit(8).lean(),
    withPayments ? Payment.find(owned(ctx, { paidAt: { $lte: ctx.now } })).sort({ paidAt: -1 }).limit(8).lean() : [],
  ]);
  const invoices = pays.length ? await Invoice.find(owned(ctx, { _id: { $in: pays.map((p) => p.invoice) } })).select('number client').lean() : [];
  const invById = new Map(invoices.map((i) => [String(i._id), i]));
  const names = await clientNames(ctx, [...comms.map((c) => c.client), ...invoices.map((i) => i.client)]);

  const events = [
    ...comms.map((c) => ({
      type: 'communication', id: id(c._id), at: c.occurredAt, clientId: id(c.client), clientName: names.get(String(c.client)) ?? null,
      title: c.subject || `${c.channel} (${c.direction})`, channel: c.channel, direction: c.direction,
    })),
    ...pays.map((p) => {
      const inv = invById.get(String(p.invoice));
      return {
        type: 'payment', id: id(p._id), at: p.paidAt, clientId: id(inv?.client), clientName: names.get(String(inv?.client)) ?? null,
        title: `Payment received${inv ? ` for invoice ${inv.number}` : ''}`, amountMinor: p.amountMinor, currency: p.currency,
      };
    }),
  ];
  return { items: events.sort((a, b) => b.at - a.at).slice(0, 8) };
}

// ---------------------------------------------------------------- assembly

const SECTIONS = {
  contentPipeline: { needs: ['content'], run: contentPipeline },
  upcomingPosts: { needs: ['calendar'], run: upcomingPosts },
  campaigns: { needs: ['campaigns'], run: campaigns },
  tasks: { needs: ['tasks'], run: tasks },
  reviews: { needs: ['campaigns'], run: reviews },
  payments: { needs: ['payments'], run: payments },
  recentActivity: { needs: ['crm'], run: recentActivity },
};

/**
 * Builds the dashboard for ONE user. Each section is independent:
 *   state "ok"          real data (an empty result is a legitimate, honest empty state)
 *   state "unavailable" the module that owns this data has no features yet; no numbers are invented
 *   state "error"       this section failed; the others are unaffected
 * `now` and `modules` are injectable so calculations can be tested deterministically.
 */
export async function getDashboard(user, { now = new Date(), modules = MODULES, log = console } = {}) {
  const tz = user.timezone || 'UTC';
  const today = dayRange(now, tz);
  const ctx = {
    now, tz, modules, today,
    month: monthRange(now, tz),
    horizon: new Date(now.getTime() + UPCOMING_DAYS * DAY),
    owner: new mongoose.Types.ObjectId(String(user._id ?? user.id)),
  };

  const entries = await Promise.all(
    Object.entries(SECTIONS).map(async ([key, { needs, run }]) => {
      const missing = needs.find((m) => !modules[m].ready);
      if (missing) return [key, { state: 'unavailable', module: missing, label: modules[missing].label, phase: modules[missing].phase }];
      try {
        return [key, { state: 'ok', ...(await run(ctx)) }];
      } catch (err) {
        log.error(`[dashboard] section "${key}" failed: ${err.name}`);
        return [key, { state: 'error' }];
      }
    }),
  );

  return {
    generatedAt: now.toISOString(),
    timezone: tz,
    window: { todayStart: today.start.toISOString(), todayEnd: today.end.toISOString(), upcomingDays: UPCOMING_DAYS },
    definitions: DEFINITIONS,
    sections: Object.fromEntries(entries),
  };
}
