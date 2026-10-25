/**
 * Invoice tracking is bookkeeping, not payment processing: CMS records invoices you made and payments you
 * received elsewhere (bank, UPI, PayPal...). It never charges, collects or moves money, and nothing here marks an
 * invoice paid except a payment YOU record.
 *
 * Stored status is only draft / sent / void. Everything else is derived from payments and the due date:
 *   draft           being prepared. Editable, deletable, no payments, not counted anywhere.
 *   sent (Issued)   given to the brand. Amounts, brand, currency and number are locked. Takes payments.
 *   partially_paid  issued, something paid, balance left, not past due.
 *   paid            issued and the balance is zero.
 *   overdue         issued, balance left, due date before today (local day). Wins over partially_paid.
 *   void (Cancelled) withdrawn. Final. Only possible while no payment is recorded. Takes no payments and counts nowhere.
 */
export const STORED_STATUSES = ['draft', 'sent', 'void'];
export const DISPLAY_STATUSES = ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void'];
export const STATUS_LABELS = { draft: 'Draft', sent: 'Issued', partially_paid: 'Partially paid', paid: 'Paid', overdue: 'Overdue', void: 'Cancelled' };

export const PAYMENT_KINDS = ['advance', 'installment', 'final', 'other'];
export const PAYMENT_KIND_LABELS = { advance: 'Advance', installment: 'Installment', final: 'Final payment', other: 'Other' };
export const PAYMENT_METHODS = ['bank_transfer', 'upi', 'card', 'paypal', 'cash', 'cheque', 'other'];
export const PAYMENT_METHOD_LABELS = { bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card', paypal: 'PayPal', cash: 'Cash', cheque: 'Cheque', other: 'Other' };

export const SORTS = ['issueDate', 'dueDate', 'number', 'total', 'balance', 'createdAt'];

export const LIMITS = {
  items: 50,
  description: 300,
  notes: 2000,
  number: 40,
  address: 500,
  money: 1_000_000_000_000,
  quantity: 1_000_000,
  reference: 100,
  paymentNote: 300,
};
