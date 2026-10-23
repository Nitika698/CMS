import { Campaign } from '../campaigns/campaign.model.js';
import { AGREED_CAMPAIGN } from '../campaigns/campaign.constants.js';
import { Invoice } from './invoice.model.js';
import { Payment } from './payment.model.js';

/**
 * The ONE definition of the money figures, used by the dashboard AND the client page.
 * All amounts are integer minor units, grouped per currency (currencies are never added together).
 * Balances are computed from payments, never stored.
 */

/** Agreed fees: Confirmed / In progress / Delivered / Completed campaigns (not archived). */
export function agreedByCurrency(owner, extraMatch = {}) {
  return Campaign.aggregate([
    { $match: { owner, archivedAt: null, status: { $in: AGREED_CAMPAIGN }, 'fee.amountMinor': { $type: 'number' }, ...extraMatch } },
    { $group: { _id: '$fee.currency', agreed: { $sum: '$fee.amountMinor' } } },
  ]);
}

/**
 * Invoiced / collected / outstanding / overdue for invoices marked Sent.
 * Outstanding is computed per invoice and never goes below zero. `todayStart` is the user's local start of today.
 */
export function invoiceTotals(owner, todayStart, extraMatch = {}) {
  return Invoice.aggregate([
    { $match: { owner, status: 'sent', ...extraMatch } },
    {
      $lookup: {
        from: Payment.collection.name,
        let: { iid: '$_id', o: '$owner' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$invoice', '$$iid'] }, { $eq: ['$owner', '$$o'] }] } } },
          { $group: { _id: null, paid: { $sum: '$amountMinor' } } },
        ],
        as: 'p',
      },
    },
    { $addFields: { paid: { $ifNull: [{ $arrayElemAt: ['$p.paid', 0] }, 0] } } },
    { $addFields: { balance: { $max: [0, { $subtract: ['$totalMinor', '$paid'] }] } } },
    {
      $group: {
        _id: '$currency',
        invoiced: { $sum: '$totalMinor' },
        collected: { $sum: '$paid' },
        outstanding: { $sum: '$balance' },
        overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$dueDate', todayStart] }, { $gt: ['$balance', 0] }] }, '$balance', 0] } },
        openInvoices: { $sum: { $cond: [{ $gt: ['$balance', 0] }, 1, 0] } },
      },
    },
  ]);
}

/** Invoices (newest first) with what has been paid so far, for any owner-scoped match such as `{ campaign }`. */
export function invoicesWithPaid(owner, match, limit = 200) {
  return Invoice.aggregate([
    { $match: { owner, ...match } },
    {
      $lookup: {
        from: Payment.collection.name,
        let: { iid: '$_id', o: '$owner' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$invoice', '$$iid'] }, { $eq: ['$owner', '$$o'] }] } } },
          { $group: { _id: null, paid: { $sum: '$amountMinor' } } },
        ],
        as: 'p',
      },
    },
    { $addFields: { paidMinor: { $ifNull: [{ $arrayElemAt: ['$p.paid', 0] }, 0] } } },
    { $sort: { issueDate: -1, createdAt: -1 } },
    { $limit: limit },
  ]);
}
