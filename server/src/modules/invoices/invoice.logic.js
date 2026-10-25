/** Pure invoice maths and status rules. Amounts are integer minor units (cents, paise...). Nothing here touches the database. */

const roundHalfUp = (n) => Math.round(n + Number.EPSILON);

/** Net amount of one line: quantity (up to 3 decimals) x unit price, rounded to a whole minor unit. */
export const lineNet = (item) => roundHalfUp((Math.round(item.quantity * 1000) * item.unitAmountMinor) / 1000);
/** Tax on one line, rounded per line so the printed lines add up to the printed totals. */
export const lineTax = (item) => roundHalfUp((lineNet(item) * (item.taxRatePct ?? 0)) / 100);

export function computeTotals(items) {
  let subtotalMinor = 0;
  let taxMinor = 0;
  for (const item of items) {
    subtotalMinor += lineNet(item);
    taxMinor += lineTax(item);
  }
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

/** What is still owed. Never below zero, and zero for invoices that are not issued. */
export const balanceOf = (invoice, paidMinor) => (invoice.status === 'sent' ? Math.max(0, invoice.totalMinor - paidMinor) : 0);

/**
 * The status the user sees. `todayStart` is the start of the user's local day: an invoice due today is not overdue until tomorrow.
 * Overdue wins over partially paid (money is still late), and paid wins over everything for an issued invoice.
 */
export function displayStatusOf(invoice, paidMinor, todayStart) {
  if (invoice.status !== 'sent') return invoice.status;
  if (balanceOf(invoice, paidMinor) === 0) return 'paid';
  if (invoice.dueDate && invoice.dueDate < todayStart) return 'overdue';
  return paidMinor > 0 ? 'partially_paid' : 'sent';
}

/** The same rule as displayStatusOf, as a MongoDB expression over fields `status`, `balanceMinor`, `paidMinor`, `dueDate`. */
export const displayStatusExpr = (todayStart) => ({
  $switch: {
    branches: [
      { case: { $ne: ['$status', 'sent'] }, then: '$status' },
      { case: { $lte: ['$balanceMinor', 0] }, then: 'paid' },
      { case: { $gt: ['$dueDate', null] }, then: { $cond: [{ $lt: ['$dueDate', todayStart] }, 'overdue', { $cond: [{ $gt: ['$paidMinor', 0] }, 'partially_paid', 'sent'] }] } },
      { case: { $gt: ['$paidMinor', 0] }, then: 'partially_paid' },
    ],
    default: 'sent',
  },
});

/** How the next payment fits: returns the largest amount that can still be recorded. */
export const maxPayable = (invoice, paidMinor) => balanceOf(invoice, paidMinor);
