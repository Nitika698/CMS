import mongoose from 'mongoose';
import { AppError } from '../../lib/errors.js';
import { isObjectId, notFound } from '../../lib/scoped.js';
import { dayRange, formatLocal, zonedMidnight } from '../../lib/timezone.js';
import { Campaign } from '../campaigns/campaign.model.js';
import { Client } from '../clients/client.model.js';
import { nextNumber } from './counter.model.js';
import {
  DISPLAY_STATUSES, LIMITS, PAYMENT_KIND_LABELS, PAYMENT_KINDS, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, STATUS_LABELS,
} from './invoice.constants.js';
import { balanceOf, computeTotals, displayStatusExpr, displayStatusOf, lineNet, lineTax } from './invoice.logic.js';
import { Invoice } from './invoice.model.js';
import { Payment } from './payment.model.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tzOf = (user) => user.timezone || 'UTC';
const invalid = (path, message) => new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', [{ path, message }]);
const conflict = (code, message, details) => new AppError(409, code, message, details);
const MIN_MS = Date.UTC(2000, 0, 1);

/** "2026-10-31" -> local midnight of that day in the user's timezone. */
function dayToDate(s, tz) {
  const [y, m, d] = s.split('-').map(Number);
  return zonedMidnight(y, m, d, tz);
}
const localDay = (date, tz) => (date ? formatLocal(date, tz).date : null);
const todayOf = (user, now) => dayRange(now, tzOf(user));

export function invoiceMeta() {
  return {
    statuses: DISPLAY_STATUSES.map((key) => ({ key, label: STATUS_LABELS[key] })),
    paymentKinds: PAYMENT_KINDS.map((key) => ({ key, label: PAYMENT_KIND_LABELS[key] })),
    paymentMethods: PAYMENT_METHODS.map((key) => ({ key, label: PAYMENT_METHOD_LABELS[key] })),
    limits: LIMITS,
    // Said out loud in the UI too: this tracks invoices and payments you record; it does not move money.
    note: 'CMS tracks invoices and the payments you record. It does not send invoices, charge brands or process payments.',
  };
}

// ------------------------------------------------------------------ references

/** The brand must exist AND be the user's: a missing id and another user's id give the same answer. */
async function checkClient(userId, clientId, { allowArchived = false } = {}) {
  const client = isObjectId(String(clientId)) ? await Client.findOne({ _id: clientId, owner: userId }) : null;
  if (!client) throw invalid('client', 'Brand not found');
  if (client.archivedAt && !allowArchived) throw invalid('client', 'This brand is archived. Restore it before raising invoices.');
  return client;
}

/** The campaign must be the user's AND belong to the invoice's brand. */
async function checkCampaign(userId, clientId, campaignId) {
  if (!campaignId) return null;
  const campaign = isObjectId(String(campaignId)) ? await Campaign.findOne({ _id: campaignId, owner: userId, client: clientId }).select('title fee client').lean() : null;
  if (!campaign) throw invalid('campaign', 'Campaign not found for this brand');
  return campaign;
}

export async function findOwnedInvoice(userId, invoiceId) {
  if (!isObjectId(String(invoiceId))) throw notFound('Invoice');
  const invoice = await Invoice.findOne({ _id: invoiceId, owner: userId });
  if (!invoice) throw notFound('Invoice');
  return invoice;
}

const save = async (doc) => {
  try {
    return await doc.save();
  } catch (err) {
    if (err.name === 'VersionError') throw conflict('STALE_VERSION', 'This invoice was changed elsewhere. Reload and try again.');
    if (err.code === 11000) throw conflict('DUPLICATE_NUMBER', 'You already have an invoice with that number. Pick another.');
    throw err;
  }
};

async function paidTotals(owner, invoiceIds) {
  if (!invoiceIds.length) return new Map();
  const rows = await Payment.aggregate([
    { $match: { owner: oid(owner), invoice: { $in: invoiceIds.map(oid) } } },
    { $group: { _id: '$invoice', paid: { $sum: '$amountMinor' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.paid]));
}

// ------------------------------------------------------------------ presentation

const party = (p) => (p ? { name: p.name ?? null, contactName: p.contactName ?? null, email: p.email ?? null, phone: p.phone ?? null, website: p.website ?? null, address: p.address ?? null, taxIdLabel: p.taxIdLabel ?? null, taxId: p.taxId ?? null } : null);

function line(item) {
  const net = lineNet(item);
  const tax = lineTax(item);
  return { description: item.description, quantity: item.quantity, unitAmountMinor: item.unitAmountMinor, taxRatePct: item.taxRatePct ?? 0, netMinor: net, taxMinor: tax, amountMinor: net + tax };
}

function paymentView(p, tz) {
  return {
    id: String(p._id), invoiceId: String(p.invoice), amountMinor: p.amountMinor, currency: p.currency, paidOn: localDay(p.paidAt, tz), paidAt: p.paidAt,
    kind: p.kind ?? 'installment', kindLabel: PAYMENT_KIND_LABELS[p.kind ?? 'installment'], method: p.method ?? null, methodLabel: p.method ? PAYMENT_METHOD_LABELS[p.method] ?? p.method : null,
    reference: p.reference ?? null, notes: p.notes ?? null, createdAt: p.createdAt,
  };
}

function view(inv, user, { paidMinor = 0, clientName = null, campaignTitle = null, now = new Date(), payments, detail = false } = {}) {
  const tz = tzOf(user);
  const today = todayOf(user, now);
  const display = displayStatusOf(inv, paidMinor, today.start);
  const overdueDays = display === 'overdue' ? Math.max(1, Math.round((today.start - inv.dueDate) / 86_400_000)) : 0;
  const base = {
    id: String(inv._id),
    number: inv.number,
    status: inv.status,
    statusLabel: STATUS_LABELS[inv.status],
    displayStatus: display,
    displayLabel: STATUS_LABELS[display],
    client: { id: String(inv.client), name: clientName },
    campaign: inv.campaign ? { id: String(inv.campaign), title: campaignTitle } : null,
    currency: inv.currency,
    subtotalMinor: inv.subtotalMinor ?? 0,
    taxMinor: inv.taxMinor ?? 0,
    totalMinor: inv.totalMinor,
    paidMinor,
    balanceMinor: balanceOf(inv, paidMinor),
    issueDate: inv.issueDate ?? null,
    dueDate: inv.dueDate ?? null,
    issueDay: localDay(inv.issueDate, tz),
    dueDay: localDay(inv.dueDate, tz),
    overdueDays,
    lineCount: inv.lineItems?.length ?? 0,
    version: inv.__v ?? 0,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
  };
  if (!detail) return base;
  return {
    ...base,
    lineItems: (inv.lineItems ?? []).map(line),
    notes: inv.notes ?? null,
    billToAddress: inv.billToAddress ?? null,
    issuer: party(inv.issuer),
    billTo: party(inv.billTo),
    paymentInstructions: inv.paymentInstructions ?? null,
    sentAt: inv.sentAt ?? null,
    voidedAt: inv.voidedAt ?? null,
    voidReason: inv.voidReason ?? null,
    payments: (payments ?? []).map((p) => paymentView(p, tz)),
    // What can still be done, so the UI never offers a move the server would refuse.
    actions: {
      edit: inv.status !== 'void',
      editAmounts: inv.status === 'draft',
      issue: inv.status === 'draft',
      recordPayment: inv.status === 'sent' && balanceOf(inv, paidMinor) > 0,
      cancel: inv.status === 'sent' && !(payments?.length),
      revert: inv.status === 'sent' && !(payments?.length),
      delete: inv.status === 'draft',
    },
  };
}

async function present(user, docs, opts = {}) {
  if (!docs.length) return [];
  const paid = await paidTotals(user.id, docs.map((d) => d._id));
  const clients = await Client.find({ _id: { $in: [...new Set(docs.map((d) => String(d.client)))] }, owner: user.id }).select('name').lean();
  const camps = await Campaign.find({ _id: { $in: docs.map((d) => d.campaign).filter(Boolean) }, owner: user.id }).select('title').lean();
  const cName = new Map(clients.map((c) => [String(c._id), c.name]));
  const kTitle = new Map(camps.map((c) => [String(c._id), c.title]));
  return docs.map((d) => view(d, user, { ...opts, paidMinor: paid.get(String(d._id)) ?? 0, clientName: cName.get(String(d.client)) ?? null, campaignTitle: d.campaign ? kTitle.get(String(d.campaign)) ?? null : null }));
}

async function presentOne(user, doc, now = new Date()) {
  const payments = await Payment.find({ owner: user.id, invoice: doc._id }).sort({ paidAt: 1, createdAt: 1 }).lean();
  const [v] = await present(user, [doc], { now, detail: true, payments });
  return v;
}

// ------------------------------------------------------------------ list

export async function listInvoices(user, q, now = new Date()) {
  const owner = oid(user.id);
  const today = todayOf(user, now);
  const tz = tzOf(user);
  const match = { owner };
  if (q.client) match.client = oid(q.client);
  if (q.campaign) match.campaign = oid(q.campaign);
  if (q.currency) match.currency = q.currency;
  if (q.dueFrom || q.dueTo) match.dueDate = { ...(q.dueFrom && { $gte: dayToDate(q.dueFrom, tz) }), ...(q.dueTo && { $lte: dayToDate(q.dueTo, tz) }) };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const brands = await Client.find({ owner, name: rx }).select('_id').lean();
    match.$or = [{ number: rx }, { notes: rx }, { client: { $in: brands.map((b) => b._id) } }];
  }

  const paidLookup = {
    $lookup: {
      from: Payment.collection.name,
      let: { iid: '$_id', o: '$owner' },
      pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$invoice', '$$iid'] }, { $eq: ['$owner', '$$o'] }] } } },
        { $group: { _id: null, paid: { $sum: '$amountMinor' } } },
      ],
      as: 'p',
    },
  };
  const desc = q.sort.startsWith('-');
  const field = q.sort.replace(/^-/, '');
  const dir = desc ? -1 : 1;
  const key = { issueDate: 'issueDate', dueDate: 'dueDate', number: '_numberLower', total: 'totalMinor', balance: 'balanceMinor', createdAt: 'createdAt' }[field];

  const pipeline = [
    { $match: match },
    paidLookup,
    { $addFields: { paidMinor: { $ifNull: [{ $arrayElemAt: ['$p.paid', 0] }, 0] }, _numberLower: { $toLower: '$number' } } },
    { $addFields: { balanceMinor: { $cond: [{ $eq: ['$status', 'sent'] }, { $max: [0, { $subtract: ['$totalMinor', '$paidMinor'] }] }, 0] } } },
    { $addFields: { display: displayStatusExpr(today.start), _noKey: { $cond: [{ $gt: [`$${key}`, null] }, 0, 1] } } },
    ...(q.status?.length ? [{ $match: { display: { $in: q.status } } }] : []),
    {
      $facet: {
        rows: [{ $sort: { _noKey: 1, [key]: dir, createdAt: -1, _id: 1 } }, { $skip: (q.page - 1) * q.limit }, { $limit: q.limit }, { $project: { p: 0, _numberLower: 0, _noKey: 0 } }],
        count: [{ $count: 'n' }],
        totals: [
          { $match: { status: 'sent' } },
          {
            $group: {
              _id: '$currency',
              invoiced: { $sum: '$totalMinor' },
              collected: { $sum: '$paidMinor' },
              outstanding: { $sum: '$balanceMinor' },
              overdue: { $sum: { $cond: [{ $eq: ['$display', 'overdue'] }, '$balanceMinor', 0] } },
              openInvoices: { $sum: { $cond: [{ $gt: ['$balanceMinor', 0] }, 1, 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ];
  const [facet] = await Invoice.aggregate(pipeline);
  const total = facet.count[0]?.n ?? 0;
  const clients = await Client.find({ _id: { $in: [...new Set(facet.rows.map((r) => String(r.client)))] }, owner }).select('name').lean();
  const camps = await Campaign.find({ _id: { $in: facet.rows.map((r) => r.campaign).filter(Boolean) }, owner }).select('title').lean();
  const cName = new Map(clients.map((c) => [String(c._id), c.name]));
  const kTitle = new Map(camps.map((c) => [String(c._id), c.title]));
  return {
    data: facet.rows.map((r) => view(r, user, { now, paidMinor: r.paidMinor, clientName: cName.get(String(r.client)) ?? null, campaignTitle: r.campaign ? kTitle.get(String(r.campaign)) ?? null : null })),
    meta: {
      page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)),
      totals: facet.totals.map((t) => ({ currency: t._id, invoiced: t.invoiced, collected: t.collected, outstanding: t.outstanding, overdue: t.overdue, openInvoices: t.openInvoices })),
    },
  };
}

export async function getInvoice(user, invoiceId, now = new Date()) {
  return presentOne(user, await findOwnedInvoice(user.id, invoiceId), now);
}

/** For the invoice form: the agreed fee of a campaign next to what has been invoiced and collected so far. */
export async function campaignContext(user, campaignId) {
  if (!isObjectId(String(campaignId))) throw notFound('Campaign');
  const campaign = await Campaign.findOne({ _id: campaignId, owner: user.id }).select('title client fee').lean();
  if (!campaign) throw notFound('Campaign');
  const owner = oid(user.id);
  const rows = await Invoice.aggregate([
    { $match: { owner, campaign: campaign._id, status: { $in: ['draft', 'sent'] } } },
    { $lookup: { from: Payment.collection.name, let: { iid: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$invoice', '$$iid'] }, owner } }, { $group: { _id: null, paid: { $sum: '$amountMinor' } } }], as: 'p' } },
    { $group: { _id: '$currency', invoiced: { $sum: '$totalMinor' }, paid: { $sum: { $ifNull: [{ $arrayElemAt: ['$p.paid', 0] }, 0] } }, count: { $sum: 1 } } },
  ]);
  const fee = campaign.fee?.amountMinor != null ? { amountMinor: campaign.fee.amountMinor, currency: campaign.fee.currency } : null;
  const same = fee ? rows.find((r) => r._id === fee.currency) : null;
  return {
    campaign: { id: String(campaign._id), title: campaign.title, clientId: String(campaign.client) },
    fee,
    invoiced: rows.map((r) => ({ currency: r._id, invoiced: r.invoiced, collected: r.paid, invoices: r.count })),
    // Only meaningful in the fee's own currency; currencies are never added together.
    remainingToInvoiceMinor: fee ? Math.max(0, fee.amountMinor - (same?.invoiced ?? 0)) : null,
  };
}

// ------------------------------------------------------------------ create / edit

async function generateNumber(user) {
  const prefix = user.businessProfile?.invoicePrefix || 'INV';
  for (let tries = 0; tries < 20; tries += 1) {
    const seq = await nextNumber(user.id, 'invoice');
    const number = `${prefix}-${String(seq).padStart(4, '0')}`;
    if (!(await Invoice.exists({ owner: user.id, number }))) return number; // skip numbers the user typed by hand
  }
  throw new AppError(500, 'INTERNAL', 'Could not allocate an invoice number');
}

function applyLines(doc, lineItems) {
  doc.lineItems = lineItems;
  Object.assign(doc, computeTotals(lineItems));
  if (doc.totalMinor > LIMITS.money) throw invalid('lineItems', 'The invoice total is too large');
}

const toDate = (s, tz) => (s === null ? null : dayToDate(s, tz));

function checkDates(doc) {
  if (doc.issueDate && doc.dueDate && doc.dueDate < doc.issueDate) throw invalid('dueDate', 'The due date cannot be before the issue date');
}

export async function createInvoice(user, input, now = new Date()) {
  const tz = tzOf(user);
  const client = await checkClient(user.id, input.client);
  const campaign = await checkCampaign(user.id, client._id, input.campaign);
  const doc = new Invoice({
    owner: user.id,
    client: client._id,
    campaign: campaign?._id ?? null,
    number: input.number ?? (await generateNumber(user)),
    currency: input.currency ?? campaign?.fee?.currency ?? client.defaultCurrency ?? user.defaultCurrency ?? 'USD',
    notes: input.notes ?? (user.businessProfile?.invoiceNotes || undefined),
    billToAddress: input.billToAddress ?? undefined,
    issueDate: input.issueDate ? dayToDate(input.issueDate, tz) : null,
    dueDate: input.dueDate ? dayToDate(input.dueDate, tz) : null,
    totalMinor: 0,
  });
  applyLines(doc, input.lineItems ?? []);
  checkDates(doc);
  await save(doc);
  return presentOne(user, doc, now);
}

const LOCKED_WHEN_ISSUED = ['client', 'campaign', 'number', 'currency', 'issueDate', 'lineItems', 'billToAddress'];

export async function updateInvoice(user, invoiceId, input, now = new Date()) {
  const tz = tzOf(user);
  const doc = await findOwnedInvoice(user.id, invoiceId);
  if (doc.status === 'void') throw conflict('INVOICE_CANCELLED', 'This invoice is cancelled and can no longer be changed.');
  if (input.version !== undefined && input.version !== (doc.__v ?? 0)) {
    throw conflict('STALE_VERSION', 'This invoice was changed elsewhere since you opened it. Reload to see the latest version.', { currentVersion: doc.__v ?? 0 });
  }
  if (doc.status === 'sent') {
    const locked = LOCKED_WHEN_ISSUED.filter((k) => input[k] !== undefined);
    if (locked.length) {
      throw conflict('INVOICE_ISSUED', `An issued invoice keeps its amounts, brand and number. Only the due date and notes can change (not: ${locked.join(', ')}). To change the rest, move it back to draft (only possible before any payment) or cancel it and raise a new one.`, { locked });
    }
  }

  if (input.client !== undefined || input.campaign !== undefined) {
    const clientId = input.client ?? doc.client;
    const client = await checkClient(user.id, clientId, { allowArchived: String(clientId) === String(doc.client) });
    const campaignId = input.campaign !== undefined ? input.campaign : String(clientId) === String(doc.client) ? doc.campaign : null;
    await checkCampaign(user.id, client._id, campaignId);
    doc.client = client._id;
    doc.campaign = campaignId ?? null;
  }
  if (input.number !== undefined) doc.number = input.number;
  if (input.currency !== undefined) doc.currency = input.currency;
  if (input.notes !== undefined) doc.notes = input.notes ?? undefined;
  if (input.billToAddress !== undefined) doc.billToAddress = input.billToAddress ?? undefined;
  if (input.issueDate !== undefined) doc.issueDate = toDate(input.issueDate, tz);
  if (input.dueDate !== undefined) doc.dueDate = toDate(input.dueDate, tz);
  if (input.lineItems !== undefined) applyLines(doc, input.lineItems);
  checkDates(doc);
  await save(doc);
  return presentOne(user, doc, now);
}

export async function deleteInvoice(user, invoiceId) {
  const doc = await findOwnedInvoice(user.id, invoiceId);
  if (doc.status !== 'draft') throw conflict('NOT_DRAFT', 'Only drafts can be deleted. Cancel an issued invoice instead, so the record is kept.');
  await Invoice.deleteOne({ _id: doc._id, owner: user.id, status: 'draft' });
  return { deleted: true };
}

// ------------------------------------------------------------------ state changes

const hasPayments = (user, doc) => Payment.exists({ owner: user.id, invoice: doc._id });

/** draft -> issued. Freezes the amounts and takes copies of your business details and the brand's, so they print the same forever. */
export async function issueInvoice(user, invoiceId, input = {}, now = new Date()) {
  const tz = tzOf(user);
  const doc = await findOwnedInvoice(user.id, invoiceId);
  if (doc.status !== 'draft') throw conflict('NOT_DRAFT', doc.status === 'void' ? 'This invoice is cancelled.' : 'This invoice is already issued.');
  if (!doc.lineItems.length) throw invalid('lineItems', 'Add at least one line before issuing');
  if (doc.totalMinor <= 0) throw invalid('lineItems', 'The total must be more than zero before issuing');
  const client = await checkClient(user.id, doc.client, { allowArchived: true });
  await checkCampaign(user.id, client._id, doc.campaign);

  const issue = input.issueDate ? dayToDate(input.issueDate, tz) : doc.issueDate ?? todayOf(user, now).start;
  let due = input.dueDate !== undefined ? toDate(input.dueDate, tz) : doc.dueDate;
  if (!due && input.dueDate === undefined) {
    const terms = client.paymentTermsDays ?? user.businessProfile?.paymentTermsDays ?? 14;
    const [y, m, d] = localDay(issue, tz).split('-').map(Number);
    due = zonedMidnight(y, m, d + terms, tz);
  }
  doc.issueDate = issue;
  doc.dueDate = due;
  checkDates(doc);

  const b = user.businessProfile ?? {};
  const primary = client.contacts?.find((c) => c.isPrimary) ?? client.contacts?.[0];
  doc.issuer = { name: b.businessName || user.name, email: b.email || user.email, phone: b.phone, website: b.website, address: b.address, taxIdLabel: b.taxIdLabel, taxId: b.taxId };
  doc.billTo = { name: client.name, contactName: primary?.name, email: primary?.email, phone: primary?.phone, website: client.website, address: doc.billToAddress };
  doc.paymentInstructions = b.paymentInstructions || undefined;
  doc.status = 'sent';
  doc.sentAt = now;
  await save(doc);
  return presentOne(user, doc, now);
}

/** issued -> draft, only while nothing has been paid. */
export async function revertToDraft(user, invoiceId, now = new Date()) {
  const doc = await findOwnedInvoice(user.id, invoiceId);
  if (doc.status !== 'sent') throw conflict('NOT_ISSUED', doc.status === 'void' ? 'This invoice is cancelled.' : 'Only an issued invoice can go back to draft.');
  if (await hasPayments(user, doc)) throw conflict('HAS_PAYMENTS', 'Payments are recorded against this invoice. Remove them first, or keep the invoice as it is.');
  doc.status = 'draft';
  doc.sentAt = undefined;
  doc.issuer = undefined;
  doc.billTo = undefined;
  doc.paymentInstructions = undefined;
  await save(doc);
  return presentOne(user, doc, now);
}

/** issued -> cancelled (final). Refused once a payment is recorded: money you were paid cannot be cancelled away. */
export async function cancelInvoice(user, invoiceId, input = {}, now = new Date()) {
  const doc = await findOwnedInvoice(user.id, invoiceId);
  if (doc.status === 'void') return presentOne(user, doc, now); // already cancelled: harmless to repeat
  if (doc.status !== 'sent') throw conflict('NOT_ISSUED', 'A draft is not cancelled; delete it instead.');
  if (await hasPayments(user, doc)) throw conflict('HAS_PAYMENTS', 'Payments are recorded against this invoice, so it cannot be cancelled. Remove the payments first if they were entered by mistake.');
  doc.status = 'void';
  doc.voidedAt = now;
  doc.voidReason = input.reason ?? undefined;
  await save(doc);
  return presentOne(user, doc, now);
}

// ------------------------------------------------------------------ payments

function paidDate(user, input, now) {
  const today = todayOf(user, now);
  if (!input.paidOn) return today.start; // today, as a local day
  const at = dayToDate(input.paidOn, tzOf(user));
  if (at.getTime() < MIN_MS) throw invalid('paidOn', 'Choose a date after the year 2000');
  if (at >= today.end) throw invalid('paidOn', 'A payment cannot be dated in the future. Record it when it arrives.');
  return at;
}

async function paidSum(user, doc, excludeId) {
  const rows = await Payment.aggregate([
    { $match: { owner: oid(user.id), invoice: doc._id, ...(excludeId && { _id: { $ne: oid(excludeId) } }) } },
    { $group: { _id: null, paid: { $sum: '$amountMinor' } } },
  ]);
  return rows[0]?.paid ?? 0;
}

function assertTakesPayments(doc, currency) {
  if (doc.status === 'void') throw conflict('INVOICE_CANCELLED', 'This invoice is cancelled and cannot take payments.');
  if (doc.status === 'draft') throw conflict('NOT_ISSUED', 'Issue the invoice before recording payments against it.');
  if (currency && currency !== doc.currency) throw invalid('currency', `This invoice is in ${doc.currency}. Payments must be in the same currency.`);
}

const overpaid = (balanceMinor, currency) => conflict('OVERPAYMENT', 'That is more than the invoice balance. Record only what is still owed, or fix the invoice total first.', { balanceMinor, currency });

/** Records money you received. It can never exceed what the invoice still owes, so a balance is never negative. */
export async function addPayment(user, invoiceId, input, now = new Date()) {
  const doc = await findOwnedInvoice(user.id, invoiceId);
  assertTakesPayments(doc, input.currency);
  const paidBefore = await paidSum(user, doc);
  const balance = doc.totalMinor - paidBefore;
  if (input.amountMinor > balance) throw overpaid(Math.max(0, balance), doc.currency);

  const pay = await Payment.create({
    owner: user.id, invoice: doc._id, currency: doc.currency, amountMinor: input.amountMinor, paidAt: paidDate(user, input, now),
    kind: input.kind ?? 'installment', method: input.method ?? undefined, reference: input.reference ?? undefined, notes: input.notes ?? undefined,
  });
  // Two payments recorded at the same instant could both pass the check above. Re-check, and back out the later one.
  if ((await paidSum(user, doc)) > doc.totalMinor) {
    await Payment.deleteOne({ _id: pay._id, owner: user.id });
    throw overpaid(Math.max(0, doc.totalMinor - (await paidSum(user, doc))), doc.currency);
  }
  return presentOne(user, doc, now);
}

export async function updatePayment(user, invoiceId, paymentId, input, now = new Date()) {
  const doc = await findOwnedInvoice(user.id, invoiceId);
  const pay = isObjectId(String(paymentId)) ? await Payment.findOne({ _id: paymentId, owner: user.id, invoice: doc._id }) : null;
  if (!pay) throw notFound('Payment');
  assertTakesPayments(doc, input.currency);
  if (input.amountMinor !== undefined) {
    const others = await paidSum(user, doc, pay._id);
    if (others + input.amountMinor > doc.totalMinor) throw overpaid(Math.max(0, doc.totalMinor - others), doc.currency);
    pay.amountMinor = input.amountMinor;
  }
  if (input.paidOn !== undefined) pay.paidAt = paidDate(user, input, now);
  for (const k of ['kind', 'method', 'reference', 'notes']) if (input[k] !== undefined) pay[k] = input[k] ?? undefined;
  await pay.save();
  return presentOne(user, doc, now);
}

export async function deletePayment(user, invoiceId, paymentId, now = new Date()) {
  const doc = await findOwnedInvoice(user.id, invoiceId);
  const res = isObjectId(String(paymentId)) ? await Payment.deleteOne({ _id: paymentId, owner: user.id, invoice: doc._id }) : { deletedCount: 0 };
  if (!res.deletedCount) throw notFound('Payment');
  return presentOne(user, doc, now);
}

// ------------------------------------------------------------------ download

/** The data the downloadable invoice is drawn from. Reading it never changes the invoice or any status. */
export async function invoiceForDocument(user, invoiceId, now = new Date()) {
  const doc = await findOwnedInvoice(user.id, invoiceId);
  const v = await presentOne(user, doc, now);
  if (doc.status === 'draft') {
    // A draft has no copies yet: show your CURRENT details, marked as a draft.
    const b = user.businessProfile ?? {};
    const client = await Client.findOne({ _id: doc.client, owner: user.id }).lean();
    const primary = client?.contacts?.find((c) => c.isPrimary) ?? client?.contacts?.[0];
    v.issuer = { name: b.businessName || user.name, email: b.email || user.email, phone: b.phone ?? null, website: b.website ?? null, address: b.address ?? null, taxIdLabel: b.taxIdLabel ?? null, taxId: b.taxId ?? null, contactName: null };
    v.billTo = { name: client?.name ?? null, contactName: primary?.name ?? null, email: primary?.email ?? null, phone: primary?.phone ?? null, website: client?.website ?? null, address: doc.billToAddress ?? null, taxIdLabel: null, taxId: null };
    v.paymentInstructions = b.paymentInstructions || null;
  }
  return v;
}
