import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { newClient, clients } from './helpers/clients.js';
import { camps, day, newCampaign } from './helpers/campaigns.js';
import { setTimezone } from './helpers/calendar.js';
import { inv, issuedInvoice, line, newInvoice } from './helpers/invoices.js';
import { runReminderSweep } from '../src/jobs/reminders.js';
import { computeTotals, displayStatusOf } from '../src/modules/invoices/invoice.logic.js';
import { Invoice } from '../src/modules/invoices/invoice.model.js';
import { Notification } from '../src/modules/notifications/notification.model.js';
import { Payment } from '../src/modules/invoices/payment.model.js';
import { getInvoice } from '../src/modules/invoices/invoices.service.js';

useDatabase();

const at = (s) => new Date(s);
const profile = (token, businessProfile) => request(app).patch('/api/v1/me').set(bearer(token)).send({ businessProfile });
const ofType = (owner, type) => Notification.find({ owner, type }).lean();

describe('invoice maths', () => {
  test('line totals, per-line tax and decimals add up exactly in minor units', () => {
    assert.deepEqual(computeTotals([]), { subtotalMinor: 0, taxMinor: 0, totalMinor: 0 });
    assert.deepEqual(computeTotals([{ quantity: 2, unitAmountMinor: 50_000, taxRatePct: 18 }]), { subtotalMinor: 100_000, taxMinor: 18_000, totalMinor: 118_000 });
    assert.deepEqual(computeTotals([{ quantity: 1.5, unitAmountMinor: 3333, taxRatePct: 0 }]), { subtotalMinor: 5000, taxMinor: 0, totalMinor: 5000 }, '1.5 x 33.33 = 49.995 -> 50.00');
    // tax is rounded per line, so the printed lines always add up to the printed total
    const t = computeTotals([{ quantity: 1, unitAmountMinor: 333, taxRatePct: 10 }, { quantity: 1, unitAmountMinor: 333, taxRatePct: 10 }]);
    assert.deepEqual(t, { subtotalMinor: 666, taxMinor: 66, totalMinor: 732 });
    assert.equal(computeTotals([{ quantity: 3, unitAmountMinor: 0.1 * 100, taxRatePct: 0 }]).totalMinor, 30);
  });

  test('displayStatusOf follows the explicit rules', () => {
    const today = at('2026-10-14T00:00:00Z');
    const issued = { status: 'sent', totalMinor: 1000, dueDate: at('2026-10-20T00:00:00Z') };
    assert.equal(displayStatusOf({ status: 'draft', totalMinor: 1000 }, 0, today), 'draft');
    assert.equal(displayStatusOf(issued, 0, today), 'sent');
    assert.equal(displayStatusOf(issued, 400, today), 'partially_paid');
    assert.equal(displayStatusOf(issued, 1000, today), 'paid');
    assert.equal(displayStatusOf({ ...issued, dueDate: at('2026-10-13T00:00:00Z') }, 0, today), 'overdue');
    assert.equal(displayStatusOf({ ...issued, dueDate: at('2026-10-13T00:00:00Z') }, 400, today), 'overdue', 'late money stays overdue even if part was paid');
    assert.equal(displayStatusOf({ ...issued, dueDate: at('2026-10-13T00:00:00Z') }, 1000, today), 'paid', 'paying in full ends being overdue');
    assert.equal(displayStatusOf({ ...issued, dueDate: today }, 0, today), 'sent', 'due today is not overdue yet');
    assert.equal(displayStatusOf({ ...issued, dueDate: null }, 0, today), 'sent', 'no due date can never be overdue');
    assert.equal(displayStatusOf({ status: 'void', totalMinor: 1000, dueDate: at('2020-01-01T00:00:00Z') }, 0, today), 'void');
  });
});

describe('creating and editing invoices', () => {
  test('creates a draft with derived totals, an automatic number and the brand name', async () => {
    const a = await signUp();
    const client = await newClient(a.token, { name: 'Glow Co' });
    const res = await inv.create(a.token, { client, currency: 'usd', lineItems: [line({ quantity: 2, unitAmountMinor: 50_000, taxRatePct: 18, description: '  Two reels  ' })] });
    assert.equal(res.status, 201);
    const i = res.body.data;
    assert.deepEqual([i.number, i.status, i.displayStatus, i.currency], ['INV-0001', 'draft', 'draft', 'USD']);
    assert.deepEqual([i.subtotalMinor, i.taxMinor, i.totalMinor, i.paidMinor, i.balanceMinor], [100_000, 18_000, 118_000, 0, 0], 'a draft owes nothing yet');
    assert.equal(i.client.name, 'Glow Co');
    assert.equal(i.lineItems[0].description, 'Two reels');
    assert.equal(i.lineItems[0].amountMinor, 118_000);
    const second = await newInvoice(a.token);
    assert.equal(second.number, 'INV-0002');
  });

  test('numbers use your prefix, are per user, and a hand-typed number is respected without clashing', async () => {
    const a = await signUp();
    const b = await signUp();
    assert.equal((await profile(a.token, { invoicePrefix: 'ab' })).status, 200);
    assert.equal((await newInvoice(a.token)).number, 'AB-0001');
    assert.equal((await newInvoice(b.token)).number, 'INV-0001', 'another account starts at its own 1');
    const client = await newClient(a.token, { name: 'Manual' });
    assert.equal((await inv.create(a.token, { client, currency: 'USD', number: 'AB-0002' })).status, 201);
    assert.equal((await newInvoice(a.token)).number, 'AB-0003', 'the automatic number skips one you typed');
    const dup = await inv.create(a.token, { client, currency: 'USD', number: 'ab-0002'.toUpperCase() });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_NUMBER');
    assert.equal((await Invoice.countDocuments({ owner: a.user.id })), 3);
  });

  test('currency falls back to the campaign fee, then the account default', async () => {
    const a = await signUp();
    const { id: campaign, client } = await newCampaign(a.token, { fee: { amountMinor: 500_000, currency: 'EUR' } });
    const fromCampaign = await inv.create(a.token, { client, campaign });
    assert.equal(fromCampaign.body.data.currency, 'EUR');
    const plain = await inv.create(a.token, { client: await newClient(a.token, { name: 'Plain' }) });
    assert.equal(plain.body.data.currency, 'USD', 'the account default');
  });

  test('validates input and creates nothing when it is wrong', async () => {
    const a = await signUp();
    const client = await newClient(a.token);
    const bad = async (body) => (await inv.create(a.token, { client, ...body })).status;
    assert.equal((await inv.create(a.token, {})).status, 400, 'a brand is required');
    assert.equal(await bad({ currency: 'US' }), 400);
    assert.equal(await bad({ currency: 'DOLLARS' }), 400);
    assert.equal(await bad({ lineItems: [line({ unitAmountMinor: -1 })] }), 400);
    assert.equal(await bad({ lineItems: [line({ unitAmountMinor: 10.5 })] }), 400, 'whole minor units only');
    assert.equal(await bad({ lineItems: [line({ quantity: 0 })] }), 400);
    assert.equal(await bad({ lineItems: [line({ quantity: 1.0001 })] }), 400);
    assert.equal(await bad({ lineItems: [line({ taxRatePct: 101 })] }), 400);
    assert.equal(await bad({ lineItems: [line({ description: '' })] }), 400);
    assert.equal(await bad({ lineItems: Array.from({ length: 51 }, () => line()) }), 400);
    assert.equal(await bad({ issueDate: '2026-02-30' }), 400);
    assert.equal(await bad({ issueDate: '2026-10-20', dueDate: '2026-10-19' }), 400, 'due before issue');
    assert.equal(await bad({ number: 'bad number!' }), 400);
    for (const forbidden of [{ owner: a.user.id }, { status: 'sent' }, { totalMinor: 5 }, { paidMinor: 5 }, { subtotalMinor: 1 }, { issuer: { name: 'x' } }]) assert.equal(await bad(forbidden), 400, JSON.stringify(forbidden));
    assert.equal(await Invoice.countDocuments({}), 0);
  });

  test('the brand and campaign must be yours and belong together; foreign and missing look the same', async () => {
    const a = await signUp();
    const b = await signUp();
    const mine = await newClient(a.token, { name: 'Mine' });
    const theirs = await newClient(b.token, { name: 'Theirs' });
    const theirCamp = await newCampaign(b.token);
    const ghost = '64b64b64b64b64b64b64b64b';
    const foreign = await inv.create(a.token, { client: theirs, currency: 'USD' });
    const missing = await inv.create(a.token, { client: ghost, currency: 'USD' });
    assert.equal(foreign.status, 400);
    assert.deepEqual(foreign.body, missing.body);
    const foreignCamp = await inv.create(a.token, { client: mine, campaign: theirCamp.id, currency: 'USD' });
    const missingCamp = await inv.create(a.token, { client: mine, campaign: ghost, currency: 'USD' });
    assert.equal(foreignCamp.status, 400);
    assert.deepEqual(foreignCamp.body, missingCamp.body);
    const other = await newCampaign(a.token); // mine, but for a different brand
    const wrongBrand = await inv.create(a.token, { client: mine, campaign: other.id, currency: 'USD' });
    assert.equal(wrongBrand.status, 400);
    assert.equal(wrongBrand.body.error.details[0].path, 'campaign');
    assert.equal(await Invoice.countDocuments({}), 0);
  });

  test('an archived brand cannot get new invoices', async () => {
    const a = await signUp();
    const client = await newClient(a.token, { name: 'Gone' });
    await clients.archive(a.token, client);
    const res = await inv.create(a.token, { client, currency: 'USD' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].path, 'client');
  });

  test('a draft can be edited freely and its totals are recalculated; a stale screen cannot overwrite', async () => {
    const a = await signUp();
    const d = await newInvoice(a.token);
    const edit = await inv.patch(a.token, d.id, { lineItems: [line({ quantity: 3, unitAmountMinor: 20_000, taxRatePct: 5 })], notes: 'Thanks!', currency: 'GBP', version: d.version });
    assert.equal(edit.status, 200);
    assert.deepEqual([edit.body.data.totalMinor, edit.body.data.currency, edit.body.data.notes, edit.body.data.version], [63_000, 'GBP', 'Thanks!', d.version + 1]);
    const stale = await inv.patch(a.token, d.id, { notes: 'old screen', version: d.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_VERSION');
    assert.equal((await inv.patch(a.token, d.id, {})).status, 400);
    assert.equal((await inv.patch(a.token, d.id, { totalMinor: 1 })).status, 400, 'totals cannot be typed in');
  });

  test('deleting is for drafts only', async () => {
    const a = await signUp();
    const d = await newInvoice(a.token);
    assert.equal((await inv.remove(a.token, d.id)).status, 200);
    assert.equal((await inv.get(a.token, d.id)).status, 404);
    const issued = await issuedInvoice(a.token);
    const res = await inv.remove(a.token, issued.id);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'NOT_DRAFT');
    assert.equal(await Invoice.countDocuments({ _id: issued.id }), 1);
  });
});

describe('issuing, reverting and cancelling', () => {
  test('issuing needs lines and a total, sets dates from payment terms, and keeps a copy of your details', async () => {
    const a = await signUp();
    await profile(a.token, { businessName: 'Aanya Creates', address: '1 Studio Lane', taxIdLabel: 'GSTIN', taxId: 'GST123', paymentInstructions: 'Bank: 1234 / IFSC XYZ', paymentTermsDays: 10 });
    const client = await newClient(a.token, { name: 'Glow Co', contacts: [{ name: 'Priya', email: 'priya@glow.test', isPrimary: true }] });
    const empty = await inv.create(a.token, { client, currency: 'USD' });
    const noLines = await inv.issue(a.token, empty.body.data.id);
    assert.equal(noLines.status, 400);
    assert.equal(noLines.body.error.details[0].path, 'lineItems');
    const zero = await inv.create(a.token, { client, currency: 'USD', lineItems: [line({ unitAmountMinor: 0 })] });
    assert.equal((await inv.issue(a.token, zero.body.data.id)).status, 400, 'a zero total cannot be issued');

    const d = await newInvoice(a.token, { client });
    const res = await inv.issue(a.token, d.id);
    assert.equal(res.status, 200);
    const i = res.body.data;
    assert.deepEqual([i.status, i.displayStatus, i.statusLabel, i.balanceMinor], ['sent', 'sent', 'Issued', 100_000]);
    assert.equal(i.issueDay, day(0));
    assert.equal(i.dueDay, day(10), 'issue date + your payment terms');
    assert.deepEqual([i.issuer.name, i.issuer.taxId, i.billTo.name, i.billTo.contactName, i.billTo.email], ['Aanya Creates', 'GST123', 'Glow Co', 'Priya', 'priya@glow.test']);
    assert.equal(i.paymentInstructions, 'Bank: 1234 / IFSC XYZ');

    // changing your profile or the brand later never rewrites an issued invoice
    await profile(a.token, { businessName: 'Renamed Studio', paymentInstructions: 'New account' });
    await clients.patch(a.token, client, { name: 'Glow Renamed' });
    const after = (await inv.get(a.token, d.id)).body.data;
    assert.deepEqual([after.issuer.name, after.billTo.name, after.paymentInstructions], ['Aanya Creates', 'Glow Co', 'Bank: 1234 / IFSC XYZ']);
    assert.equal(after.client.name, 'Glow Renamed', 'the live brand name still follows the brand');
  });

  test('a brand\'s own payment terms beat your default, and explicit dates beat both', async () => {
    const a = await signUp();
    await profile(a.token, { paymentTermsDays: 30 });
    const client = await newClient(a.token, { name: 'Fast payer', paymentTermsDays: 7 });
    const byBrand = await issuedInvoice(a.token, { client });
    assert.equal(byBrand.dueDay, day(7));
    const explicit = await issuedInvoice(a.token, {}, { issueDate: day(-3), dueDate: day(2) });
    assert.deepEqual([explicit.issueDay, explicit.dueDay], [day(-3), day(2)]);
    const bad = await newInvoice(a.token);
    assert.equal((await inv.issue(a.token, bad.id, { issueDate: day(5), dueDate: day(1) })).status, 400);
  });

  test('an issued invoice locks amounts, brand, currency and number; due date and notes stay editable', async () => {
    const a = await signUp();
    const i = await issuedInvoice(a.token);
    for (const body of [{ lineItems: [line()] }, { currency: 'EUR' }, { number: 'X-1' }, { client: i.clientId }, { issueDate: day(1) }]) {
      const res = await inv.patch(a.token, i.id, body);
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal(res.body.error.code, 'INVOICE_ISSUED');
    }
    const ok = await inv.patch(a.token, i.id, { dueDate: day(40), notes: 'Extended' });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.data.dueDay, ok.body.data.notes], [day(40), 'Extended']);
    assert.equal((await inv.issue(a.token, i.id)).status, 409, 'cannot be issued twice');
  });

  test('an unpaid issued invoice can go back to draft; once a payment exists it cannot', async () => {
    const a = await signUp();
    const i = await issuedInvoice(a.token);
    const back = await inv.revert(a.token, i.id);
    assert.equal(back.status, 200);
    assert.deepEqual([back.body.data.status, back.body.data.issuer, back.body.data.paymentInstructions], ['draft', null, null]);
    assert.equal((await inv.patch(a.token, i.id, { lineItems: [line({ unitAmountMinor: 5 })] })).status, 200, 'editable again');
    assert.equal((await inv.revert(a.token, i.id)).status, 409, 'a draft cannot go back further');
    await inv.issue(a.token, i.id);
    assert.equal((await inv.pay(a.token, i.id, { amountMinor: 1 })).status, 201);
    const refused = await inv.revert(a.token, i.id);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'HAS_PAYMENTS');
  });

  test('cancelling is final, needs no payments, keeps the record, and removes it from every total', async () => {
    const a = await signUp();
    const keep = await issuedInvoice(a.token, { lineItems: [line({ unitAmountMinor: 200_000 })] });
    const gone = await issuedInvoice(a.token, { lineItems: [line({ unitAmountMinor: 100_000 })] });
    const res = await inv.cancel(a.token, gone.id, { reason: 'Campaign cancelled' });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.data.status, res.body.data.statusLabel, res.body.data.voidReason, res.body.data.balanceMinor], ['void', 'Cancelled', 'Campaign cancelled', 0]);
    assert.equal((await inv.cancel(a.token, gone.id)).status, 200, 'repeating is harmless');
    assert.equal((await inv.get(a.token, gone.id)).status, 200, 'the record is kept');
    // totals ignore it
    const list = (await inv.list(a.token)).body;
    assert.deepEqual(list.meta.totals, [{ currency: 'USD', invoiced: 200_000, collected: 0, outstanding: 200_000, overdue: 0, openInvoices: 1 }]);
    const dash = (await request(app).get('/api/v1/dashboard').set(bearer(a.token))).body.sections.payments.currencies[0];
    assert.deepEqual([dash.invoiced, dash.outstanding], [200_000, 200_000]);
    // and nothing else can be done to it
    assert.equal((await inv.patch(a.token, gone.id, { notes: 'x' })).status, 409);
    assert.equal((await inv.issue(a.token, gone.id)).status, 409);
    assert.equal((await inv.revert(a.token, gone.id)).status, 409);
    assert.equal((await inv.remove(a.token, gone.id)).status, 409);
    const pay = await inv.pay(a.token, gone.id, { amountMinor: 100 });
    assert.equal(pay.status, 409);
    assert.equal(pay.body.error.code, 'INVOICE_CANCELLED');
    assert.equal((await inv.get(a.token, keep.id)).body.data.displayStatus, 'sent');
  });

  test('an invoice with a payment cannot be cancelled; removing the payment first allows it', async () => {
    const a = await signUp();
    const i = await issuedInvoice(a.token);
    const p = await inv.pay(a.token, i.id, { amountMinor: 1000 });
    const refused = await inv.cancel(a.token, i.id);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'HAS_PAYMENTS');
    assert.equal((await inv.removePayment(a.token, i.id, p.body.data.payments[0].id)).status, 200);
    assert.equal((await inv.cancel(a.token, i.id)).status, 200);
  });

  test('a draft cannot be cancelled (delete it) and takes no payments', async () => {
    const a = await signUp();
    const d = await newInvoice(a.token);
    assert.equal((await inv.cancel(a.token, d.id)).status, 409);
    const pay = await inv.pay(a.token, d.id, { amountMinor: 100 });
    assert.equal(pay.status, 409);
    assert.equal(pay.body.error.code, 'NOT_ISSUED');
    assert.equal(await Payment.countDocuments({}), 0);
  });
});

describe('payments: advance, partial, full and overpayments', () => {
  const issuedFor = (token, total = 100_000) => issuedInvoice(token, { lineItems: [line({ unitAmountMinor: total })] });

  test('partial payments reduce the balance and are computed, never typed in', async () => {
    const a = await signUp();
    const i = await issuedFor(a.token);
    const p1 = await inv.pay(a.token, i.id, { amountMinor: 30_000, kind: 'advance', method: 'bank_transfer', reference: 'TXN-1', paidOn: day(-2) });
    assert.equal(p1.status, 201);
    assert.deepEqual([p1.body.data.paidMinor, p1.body.data.balanceMinor, p1.body.data.displayStatus], [30_000, 70_000, 'partially_paid']);
    const pay = p1.body.data.payments[0];
    assert.deepEqual([pay.kind, pay.kindLabel, pay.method, pay.methodLabel, pay.reference, pay.paidOn, pay.currency], ['advance', 'Advance', 'bank_transfer', 'Bank transfer', 'TXN-1', day(-2), 'USD']);
    const p2 = await inv.pay(a.token, i.id, { amountMinor: 20_000, kind: 'installment', method: 'upi' });
    assert.deepEqual([p2.body.data.paidMinor, p2.body.data.balanceMinor, p2.body.data.payments.length], [50_000, 50_000, 2]);
    assert.equal(p2.body.data.payments[1].paidOn, day(0), 'defaults to today');
    // the invoice document holds no balance of its own
    const raw = await Invoice.findById(i.id).lean();
    assert.equal(raw.paidMinor, undefined);
    assert.equal(raw.balanceMinor, undefined);
  });

  test('paying the exact remainder marks it paid, and the invoice then takes no more', async () => {
    const a = await signUp();
    const i = await issuedFor(a.token);
    await inv.pay(a.token, i.id, { amountMinor: 60_000 });
    const last = await inv.pay(a.token, i.id, { amountMinor: 40_000, kind: 'final' });
    assert.deepEqual([last.body.data.displayStatus, last.body.data.balanceMinor, last.body.data.actions.recordPayment], ['paid', 0, false]);
    const extra = await inv.pay(a.token, i.id, { amountMinor: 1 });
    assert.equal(extra.status, 409);
    assert.equal(extra.body.error.code, 'OVERPAYMENT');
    assert.equal(extra.body.error.details.balanceMinor, 0);
  });

  test('an overpayment is refused with the real balance, and nothing is recorded', async () => {
    const a = await signUp();
    const i = await issuedFor(a.token);
    await inv.pay(a.token, i.id, { amountMinor: 90_000 });
    const over = await inv.pay(a.token, i.id, { amountMinor: 10_001 });
    assert.equal(over.status, 409);
    assert.equal(over.body.error.code, 'OVERPAYMENT');
    assert.deepEqual([over.body.error.details.balanceMinor, over.body.error.details.currency], [10_000, 'USD']);
    assert.equal(await Payment.countDocuments({ invoice: i.id }), 1);
    assert.equal((await inv.get(a.token, i.id)).body.data.balanceMinor, 10_000, 'the balance never goes negative');
  });

  test('two payments recorded at the same moment cannot together overpay', async () => {
    const a = await signUp();
    const i = await issuedFor(a.token, 100_000);
    const results = await Promise.all([inv.pay(a.token, i.id, { amountMinor: 70_000 }), inv.pay(a.token, i.id, { amountMinor: 70_000 })]);
    assert.ok(results.filter((r) => r.status === 201).length <= 1, 'at most one of them can succeed');
    const total = (await Payment.find({ invoice: i.id }).lean()).reduce((n, p) => n + p.amountMinor, 0);
    assert.ok(total <= 100_000, `recorded ${total}`);
  });

  test('editing a payment is held to the same limit; removing one reopens the balance', async () => {
    const a = await signUp();
    const i = await issuedFor(a.token);
    const first = (await inv.pay(a.token, i.id, { amountMinor: 40_000 })).body.data.payments[0];
    const second = (await inv.pay(a.token, i.id, { amountMinor: 50_000 })).body.data.payments[1];
    const tooMuch = await inv.patchPayment(a.token, i.id, second.id, { amountMinor: 60_001 });
    assert.equal(tooMuch.status, 409);
    assert.equal(tooMuch.body.error.code, 'OVERPAYMENT');
    const ok = await inv.patchPayment(a.token, i.id, second.id, { amountMinor: 60_000, method: 'cash', reference: 'receipt 7' });
    assert.deepEqual([ok.status, ok.body.data.balanceMinor, ok.body.data.displayStatus], [200, 0, 'paid']);
    const removed = await inv.removePayment(a.token, i.id, first.id);
    assert.deepEqual([removed.body.data.paidMinor, removed.body.data.balanceMinor, removed.body.data.displayStatus], [60_000, 40_000, 'partially_paid']);
    assert.equal((await inv.removePayment(a.token, i.id, first.id)).status, 404);
  });

  test('payments are validated: amount, currency, date and unknown fields', async () => {
    const a = await signUp();
    const i = await issuedFor(a.token);
    const bad = async (body) => (await inv.pay(a.token, i.id, body)).status;
    assert.equal(await bad({}), 400, 'amount required');
    assert.equal(await bad({ amountMinor: 0 }), 400);
    assert.equal(await bad({ amountMinor: -5 }), 400);
    assert.equal(await bad({ amountMinor: 10.5 }), 400);
    assert.equal(await bad({ amountMinor: 100, method: 'bitcoin' }), 400);
    assert.equal(await bad({ amountMinor: 100, kind: 'gift' }), 400);
    assert.equal(await bad({ amountMinor: 100, paidOn: day(1) }), 400, 'not in the future');
    assert.equal(await bad({ amountMinor: 100, paidOn: '2026-02-30' }), 400);
    assert.equal(await bad({ amountMinor: 100, owner: a.user.id }), 400);
    assert.equal(await bad({ amountMinor: 100, invoice: i.id }), 400);
    const wrongCurrency = await inv.pay(a.token, i.id, { amountMinor: 100, currency: 'EUR' });
    assert.equal(wrongCurrency.status, 400);
    assert.equal(wrongCurrency.body.error.details[0].path, 'currency');
    assert.equal((await inv.pay(a.token, i.id, { amountMinor: 100, currency: 'usd' })).status, 201, 'same currency, any case');
    assert.equal(await Payment.countDocuments({}), 1);
  });

  test('zero-decimal currencies work in whole units, and currencies are never mixed', async () => {
    const a = await signUp();
    const yen = await issuedInvoice(a.token, { currency: 'JPY', lineItems: [line({ unitAmountMinor: 50_000 })] });
    const usd = await issuedInvoice(a.token, { currency: 'USD', lineItems: [line({ unitAmountMinor: 10_000 })] });
    await inv.pay(a.token, yen.id, { amountMinor: 20_000 });
    await inv.pay(a.token, usd.id, { amountMinor: 2_500 });
    const totals = (await inv.list(a.token)).body.meta.totals;
    assert.deepEqual(totals, [
      { currency: 'JPY', invoiced: 50_000, collected: 20_000, outstanding: 30_000, overdue: 0, openInvoices: 1 },
      { currency: 'USD', invoiced: 10_000, collected: 2_500, outstanding: 7_500, overdue: 0, openInvoices: 1 },
    ]);
    const html = (await inv.download(a.token, yen.id)).text;
    assert.match(html, /¥50,000/, 'yen has no decimals');
  });
});

describe('overdue status', () => {
  test('past the due date with a balance is overdue; due today is not; paid or cancelled never are', async () => {
    const a = await signUp();
    const late = await issuedInvoice(a.token, {}, { issueDate: day(-20), dueDate: day(-3) });
    const today = await issuedInvoice(a.token, {}, { issueDate: day(-10), dueDate: day(0) });
    const later = await issuedInvoice(a.token, {}, { dueDate: day(5) });
    const paidLate = await issuedInvoice(a.token, {}, { issueDate: day(-20), dueDate: day(-3) });
    await inv.pay(a.token, paidLate.id, { amountMinor: 100_000, paidOn: day(-1) });
    const cancelledLate = await issuedInvoice(a.token, {}, { issueDate: day(-20), dueDate: day(-3) });
    await inv.cancel(a.token, cancelledLate.id);
    const status = async (i) => (await inv.get(a.token, i.id)).body.data;
    const l = await status(late);
    assert.deepEqual([l.displayStatus, l.overdueDays, l.displayLabel], ['overdue', 3, 'Overdue']);
    assert.equal((await status(today)).displayStatus, 'sent');
    assert.equal((await status(later)).displayStatus, 'sent');
    assert.equal((await status(paidLate)).displayStatus, 'paid');
    assert.equal((await status(cancelledLate)).displayStatus, 'void');
    assert.equal((await inv.list(a.token, 'status=overdue')).body.data.map((x) => x.id).join(), late.id);
    const overdueTotal = (await inv.list(a.token)).body.meta.totals[0].overdue;
    assert.equal(overdueTotal, 100_000, 'only the late, unpaid balance counts as overdue money');
  });

  test('a part-paid late invoice is still overdue, and only its unpaid part counts', async () => {
    const a = await signUp();
    const i = await issuedInvoice(a.token, {}, { issueDate: day(-20), dueDate: day(-1) });
    await inv.pay(a.token, i.id, { amountMinor: 40_000, paidOn: day(-5) });
    const got = (await inv.get(a.token, i.id)).body.data;
    assert.deepEqual([got.displayStatus, got.balanceMinor], ['overdue', 60_000]);
    assert.equal((await inv.list(a.token)).body.meta.totals[0].overdue, 60_000);
    await inv.pay(a.token, i.id, { amountMinor: 60_000 });
    assert.equal((await inv.get(a.token, i.id)).body.data.displayStatus, 'paid', 'paying the rest ends the overdue state');
  });

  test('extending the due date takes an invoice out of overdue', async () => {
    const a = await signUp();
    const i = await issuedInvoice(a.token, {}, { issueDate: day(-20), dueDate: day(-1) });
    assert.equal((await inv.get(a.token, i.id)).body.data.displayStatus, 'overdue');
    await inv.patch(a.token, i.id, { dueDate: day(7) });
    assert.equal((await inv.get(a.token, i.id)).body.data.displayStatus, 'sent');
  });

  test('"today" is the user\'s local day, so the same invoice flips at local midnight', async () => {
    const a = await signUp();
    const i = await issuedInvoice(a.token, {}, { issueDate: day(-5), dueDate: day(0) });
    // the due date is stored as UTC midnight of today; ask what a Kolkata user and an Auckland user see at one instant
    const now = at(`${day(0)}T20:00:00Z`);
    const utc = await getInvoice({ id: a.user.id, timezone: 'UTC' }, i.id, now);
    assert.equal(utc.displayStatus, 'sent', 'still the due day in UTC');
    const doc = await Invoice.findById(i.id);
    doc.dueDate = at('2026-10-13T18:30:00Z'); // the 14th, local midnight in Kolkata
    await doc.save();
    const early = await getInvoice({ id: a.user.id, timezone: 'Asia/Kolkata' }, i.id, at('2026-10-14T10:00:00Z'));
    const next = await getInvoice({ id: a.user.id, timezone: 'Asia/Kolkata' }, i.id, at('2026-10-14T18:29:59Z'));
    const late = await getInvoice({ id: a.user.id, timezone: 'Asia/Kolkata' }, i.id, at('2026-10-14T18:30:00Z'));
    assert.deepEqual([early.displayStatus, next.displayStatus, late.displayStatus], ['sent', 'sent', 'overdue'], 'flips exactly at local midnight');
    assert.equal(late.overdueDays, 1);
  });
});

describe('listing, filtering and totals', () => {
  async function seed(token) {
    const glow = await newClient(token, { name: 'Glow Co' });
    const zest = await newClient(token, { name: 'Zest Foods' });
    const { id: campaign } = await newCampaign(token, { client: glow, title: 'Spring' });
    const a = await issuedInvoice(token, { client: glow, campaign, lineItems: [line({ unitAmountMinor: 300_000 })] }, { issueDate: day(-30), dueDate: day(-10) }); // overdue
    const b = await issuedInvoice(token, { client: zest, lineItems: [line({ unitAmountMinor: 100_000 })] }, { issueDate: day(-5), dueDate: day(20) });
    await inv.pay(token, b.id, { amountMinor: 25_000 });
    const c = await issuedInvoice(token, { client: zest, currency: 'EUR', lineItems: [line({ unitAmountMinor: 50_000 })] }, { issueDate: day(-2), dueDate: day(12) });
    await inv.pay(token, c.id, { amountMinor: 50_000 });
    const d = await newInvoice(token, { client: glow, lineItems: [line({ unitAmountMinor: 70_000 })] });
    return { glow, zest, campaign, a, b, c, d };
  }
  const ids = async (token, q) => (await inv.list(token, q)).body.data.map((x) => x.id);

  test('filters by status, brand, campaign, currency, due range and search, and they combine', async () => {
    const t = await signUp();
    const s = await seed(t.token);
    assert.deepEqual(await ids(t.token, 'status=overdue'), [s.a.id]);
    assert.deepEqual(await ids(t.token, 'status=partially_paid'), [s.b.id]);
    assert.deepEqual(await ids(t.token, 'status=paid'), [s.c.id]);
    assert.deepEqual(await ids(t.token, 'status=draft'), [s.d.id]);
    assert.equal((await ids(t.token, 'status=overdue,paid')).length, 2);
    assert.equal((await ids(t.token, `client=${s.zest}`)).length, 2);
    assert.deepEqual(await ids(t.token, `campaign=${s.campaign}`), [s.a.id]);
    assert.deepEqual(await ids(t.token, 'currency=EUR'), [s.c.id]);
    assert.deepEqual((await ids(t.token, `dueFrom=${day(0)}&dueTo=${day(15)}`)), [s.c.id]);
    assert.deepEqual((await ids(t.token, 'q=zest')).sort(), [s.b.id, s.c.id].sort(), 'search finds the brand name');
    assert.deepEqual(await ids(t.token, `q=${s.a.number}`), [s.a.id], 'and the invoice number');
    assert.deepEqual(await ids(t.token, `client=${s.zest}&currency=USD&status=partially_paid`), [s.b.id]);
    assert.deepEqual(await ids(t.token, 'q=.*'), [], 'search text is not a regular expression');
    assert.equal((await inv.list(t.token, 'status=bogus')).status, 400);
  });

  test('sorts by due date (undated last), total, balance and number; paginates with an exact total', async () => {
    const t = await signUp();
    const s = await seed(t.token);
    assert.deepEqual(await ids(t.token, 'sort=dueDate'), [s.a.id, s.c.id, s.b.id, s.d.id], 'the draft has no due date and sorts last');
    assert.deepEqual(await ids(t.token, 'sort=-dueDate'), [s.b.id, s.c.id, s.a.id, s.d.id]);
    assert.equal((await ids(t.token, 'sort=-total'))[0], s.a.id);
    assert.equal((await ids(t.token, 'sort=-balance'))[0], s.a.id);
    assert.deepEqual(await ids(t.token, 'sort=number'), [s.a.id, s.b.id, s.c.id, s.d.id]);
    const page = (await inv.list(t.token, 'sort=number&limit=3&page=2')).body;
    assert.deepEqual([page.data.length, page.meta.total, page.meta.pages], [1, 4, 2]);
    assert.equal((await inv.list(t.token, 'sort=nonsense')).status, 400);
    assert.equal((await inv.list(t.token, 'limit=1000')).status, 400);
  });

  test('totals are per currency, count only issued invoices, and agree with the dashboard and the brand page', async () => {
    const t = await signUp();
    const s = await seed(t.token);
    const totals = (await inv.list(t.token)).body.meta.totals;
    assert.deepEqual(totals, [
      { currency: 'EUR', invoiced: 50_000, collected: 50_000, outstanding: 0, overdue: 0, openInvoices: 0 },
      { currency: 'USD', invoiced: 400_000, collected: 25_000, outstanding: 375_000, overdue: 300_000, openInvoices: 2 },
    ]);
    const dash = (await request(app).get('/api/v1/dashboard').set(bearer(t.token))).body.sections.payments.currencies;
    const usd = dash.find((c) => c.currency === 'USD');
    assert.deepEqual([usd.invoiced, usd.collected, usd.outstanding, usd.overdue], [400_000, 25_000, 375_000, 300_000]);
    const brand = (await clients.invoices(t.token, s.zest)).body;
    assert.deepEqual(brand.data.map((i) => i.displayStatus).sort(), ['paid', 'partially_paid']);
    assert.equal(brand.available, true);
  });

  test('the context for a campaign shows its agreed fee next to what has been invoiced', async () => {
    const t = await signUp();
    const { id: campaign, client } = await newCampaign(t.token, { fee: { amountMinor: 500_000, currency: 'USD' } });
    await issuedInvoice(t.token, { client, campaign, lineItems: [line({ unitAmountMinor: 200_000 })] });
    await newInvoice(t.token, { client, campaign, lineItems: [line({ unitAmountMinor: 100_000 })] });
    const ctx = (await inv.context(t.token, campaign)).body.data;
    assert.deepEqual(ctx.fee, { amountMinor: 500_000, currency: 'USD' });
    assert.deepEqual(ctx.invoiced, [{ currency: 'USD', invoiced: 300_000, collected: 0, invoices: 2 }]);
    assert.equal(ctx.remainingToInvoiceMinor, 200_000);
    const detail = (await camps.get(t.token, campaign)).body.data.linked.invoices;
    assert.equal(detail.length, 2, 'the campaign page reads the same invoices');
  });
});

describe('downloadable invoice', () => {
  test('is a self-contained attachment with the number, parties, lines, totals, due date and payment instructions', async () => {
    const a = await signUp();
    await profile(a.token, { businessName: 'Aanya Creates', email: 'hello@aanya.test', address: '1 Studio Lane\nPune', taxIdLabel: 'GSTIN', taxId: 'GST123', paymentInstructions: 'Pay to account 1234\nIFSC XYZ' });
    const client = await newClient(a.token, { name: 'Glow Co' });
    const i = await issuedInvoice(a.token, { client, lineItems: [line({ description: 'Two reels', quantity: 2, unitAmountMinor: 50_000, taxRatePct: 18 })], notes: 'Thank you!' }, { issueDate: '2026-10-01', dueDate: '2026-10-15' });
    const res = await inv.download(a.token, i.id);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.headers['content-disposition'], /^attachment; filename="invoice-INV-0001\.html"$/);
    assert.match(res.headers['content-security-policy'], /default-src 'none'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    for (const needle of ['INVOICE', 'INV-0001', 'Aanya Creates', 'hello@aanya.test', 'GSTIN: GST123', 'Glow Co', 'Two reels', '$1,180.00', '$1,000.00', '$180.00', '1 October 2026', '15 October 2026', 'Pay to account 1234', 'Thank you!']) {
      assert.ok(res.text.includes(needle), `missing ${needle}`);
    }
    assert.ok(!res.text.includes('<script'), 'no scripts');
    assert.ok(!/https?:\/\//.test(res.text.replace(/<!doctype[^>]*>/i, '')), 'no external requests');
  });

  test('downloading never marks anything paid, issued or changed', async () => {
    const a = await signUp();
    const draft = await newInvoice(a.token);
    const issued = await issuedInvoice(a.token);
    const before = await Promise.all([Invoice.find({}).lean(), Payment.countDocuments({})]);
    for (const i of [draft, issued]) for (let n = 0; n < 2; n += 1) assert.equal((await inv.download(a.token, i.id)).status, 200);
    const after = await Promise.all([Invoice.find({}).lean(), Payment.countDocuments({})]);
    assert.deepEqual(after, before, 'not a single field changed');
    assert.equal((await inv.get(a.token, draft.id)).body.data.status, 'draft');
    const got = (await inv.get(a.token, issued.id)).body.data;
    assert.deepEqual([got.displayStatus, got.paidMinor, got.balanceMinor], ['sent', 0, 100_000]);
    assert.equal(await Notification.countDocuments({}), 0);
  });

  test('shows what was actually paid and still owed, and marks drafts and cancelled invoices', async () => {
    const a = await signUp();
    const i = await issuedInvoice(a.token);
    await inv.pay(a.token, i.id, { amountMinor: 40_000, method: 'upi', kind: 'advance', paidOn: '2026-10-02' });
    const html = (await inv.download(a.token, i.id)).text;
    assert.ok(html.includes('Payments recorded') && html.includes('Advance') && html.includes('UPI') && html.includes('2 October 2026'));
    assert.ok(html.includes('Balance due') && html.includes('$600.00'));
    assert.ok(html.includes('does not by itself mean this invoice has been paid'));
    const draft = await newInvoice(a.token);
    assert.ok((await inv.download(a.token, draft.id)).text.includes('>DRAFT<'));
    const gone = await issuedInvoice(a.token);
    await inv.cancel(a.token, gone.id);
    assert.ok((await inv.download(a.token, gone.id)).text.includes('>CANCELLED<'));
  });

  test('everything a user typed is escaped', async () => {
    const a = await signUp();
    const evil = '<img src=x onerror=alert(1)>"\'&';
    await profile(a.token, { businessName: evil, address: evil, paymentInstructions: evil });
    const client = await newClient(a.token, { name: evil.replace(/[<>]/g, '') + ' <b>Brand</b>' });
    const i = await issuedInvoice(a.token, { client, notes: evil, lineItems: [line({ description: evil })] });
    const html = (await inv.download(a.token, i.id)).text;
    assert.ok(!html.includes('<img'), 'no raw tag from user text');
    assert.ok(!html.includes('<b>Brand'), 'the brand name is escaped too');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!html.includes('onerror=alert(1)>"'));
  });

  test('uses today\'s details for a draft, and the filename is safe', async () => {
    const a = await signUp();
    await profile(a.token, { businessName: 'Live Name' });
    const client = await newClient(a.token, { name: 'Safe' });
    const res = await inv.create(a.token, { client, currency: 'USD', number: 'A/B..1', lineItems: [line()] });
    const dl = await inv.download(a.token, res.body.data.id);
    assert.ok(dl.text.includes('Live Name'));
    assert.match(dl.headers['content-disposition'], /filename="invoice-A_B\.\.1\.html"/);
  });
});

describe('business details', () => {
  test('are saved field by field, validated, and never wipe each other', async () => {
    const a = await signUp();
    assert.equal((await profile(a.token, { businessName: 'Aanya', email: 'Hello@Aanya.test' })).body.user.businessProfile.email, 'hello@aanya.test');
    const next = await profile(a.token, { paymentInstructions: 'UPI: aanya@bank' });
    assert.deepEqual([next.body.user.businessProfile.businessName, next.body.user.businessProfile.paymentInstructions], ['Aanya', 'UPI: aanya@bank']);
    assert.equal(next.body.user.businessProfile.invoicePrefix, 'INV');
    assert.equal(next.body.user.businessProfile.paymentTermsDays, 14);
    assert.equal((await profile(a.token, { email: 'not-an-email' })).status, 400);
    assert.equal((await profile(a.token, { invoicePrefix: 'bad prefix!' })).status, 400);
    assert.equal((await profile(a.token, { paymentTermsDays: -1 })).status, 400);
    assert.equal((await profile(a.token, { paymentTermsDays: 1.5 })).status, 400);
    assert.equal((await profile(a.token, { businessName: 'x'.repeat(121) })).status, 400);
    assert.equal((await profile(a.token, { mystery: 1 })).status, 400);
    assert.equal((await profile(a.token, {})).status, 400);
    assert.equal((await request(app).get('/api/v1/me').set(bearer(a.token))).body.user.businessProfile.businessName, 'Aanya');
  });
});

describe('access control', () => {
  test('every invoice endpoint requires a signed-in user', async () => {
    const id = '64b64b64b64b64b64b64b64b';
    const calls = [
      request(app).get('/api/v1/invoices'), request(app).get('/api/v1/invoices/meta'), request(app).post('/api/v1/invoices').send({}),
      request(app).get(`/api/v1/invoices/${id}`), request(app).patch(`/api/v1/invoices/${id}`).send({ notes: 'x' }), request(app).delete(`/api/v1/invoices/${id}`),
      request(app).get(`/api/v1/invoices/${id}/download`), request(app).post(`/api/v1/invoices/${id}/issue`), request(app).post(`/api/v1/invoices/${id}/cancel`),
      request(app).post(`/api/v1/invoices/${id}/payments`).send({ amountMinor: 1 }), request(app).delete(`/api/v1/invoices/${id}/payments/${id}`),
    ];
    for (const res of await Promise.all(calls)) assert.equal(res.status, 401);
  });

  test('another user\'s invoice and payments look exactly like missing ones, and nothing changes', async () => {
    const a = await signUp();
    const b = await signUp();
    const mine = await issuedInvoice(a.token);
    const paid = (await inv.pay(a.token, mine.id, { amountMinor: 10_000 })).body.data.payments[0];
    const ghost = '64b64b64b64b64b64b64b64b';
    const probes = (id, pid) => [
      (t) => inv.get(t, id), (t) => inv.patch(t, id, { notes: 'hijack' }), (t) => inv.remove(t, id), (t) => inv.download(t, id), (t) => inv.issue(t, id),
      (t) => inv.revert(t, id), (t) => inv.cancel(t, id), (t) => inv.pay(t, id, { amountMinor: 1 }), (t) => inv.patchPayment(t, id, pid, { amountMinor: 1 }), (t) => inv.removePayment(t, id, pid),
    ];
    for (const [n, probe] of probes(mine.id, paid.id).entries()) {
      const foreign = await probe(b.token);
      const missing = await probes(ghost, ghost)[n](b.token);
      assert.equal(foreign.status, 404, `probe ${n}`);
      assert.equal(foreign.text, missing.text, `probe ${n}: no information leaks`);
    }
    assert.equal((await inv.get(a.token, 'not-an-id')).status, 404);
    const still = await Invoice.findById(mine.id).lean();
    assert.deepEqual([still.status, still.notes], ['sent', undefined]);
    assert.equal(await Payment.countDocuments({ invoice: mine.id }), 1);
  });

  test('lists, totals, context and search only ever contain the caller\'s records', async () => {
    const a = await signUp();
    const b = await signUp();
    const client = await newClient(a.token, { name: 'ALPHA brand' });
    await issuedInvoice(a.token, { client });
    const theirs = await issuedInvoice(b.token, { client: await newClient(b.token, { name: 'BRAVO brand' }), lineItems: [line({ unitAmountMinor: 999_999 })] });
    const theirCamp = await newCampaign(b.token);
    const seen = JSON.stringify([(await inv.list(a.token)).body, (await inv.list(a.token, 'q=BRAVO')).body, (await inv.list(a.token, `client=${theirs.clientId}`)).body]);
    assert.ok(!seen.includes('BRAVO') && !seen.includes(theirs.number + theirs.id));
    assert.equal((await inv.list(a.token)).body.meta.totals[0].invoiced, 100_000);
    assert.equal((await inv.context(a.token, theirCamp.id)).status, 404);
    const trick = await request(app).get(`/api/v1/invoices?owner=${b.user.id}`).set(bearer(a.token)).set('X-User-Id', b.user.id);
    assert.equal(trick.body.data.length, 1);
    assert.equal((await request(app).get('/api/v1/dashboard').set(bearer(b.token))).body.sections.payments.currencies[0].invoiced, 999_999);
  });

  test('meta explains that this tracks invoices and payments but does not process them', async () => {
    const a = await signUp();
    const m = (await inv.meta(a.token)).body;
    assert.match(m.note, /does not send invoices, charge brands or process payments/);
    assert.deepEqual(m.statuses.map((s) => s.key), ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void']);
  });
});

describe('invoice reminders', () => {
  test('a due-soon reminder arrives once before the end of the due day, then one overdue notice', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'Asia/Kolkata'); // the 20th ends at 2040-06-20T18:30Z
    const i = await issuedInvoice(a.token, { currency: 'INR', lineItems: [line({ unitAmountMinor: 250_000 })] }, { issueDate: '2040-06-01', dueDate: '2040-06-20' });
    assert.equal((await runReminderSweep(at('2040-06-19T18:29:59Z'))).invoiceReminders, 0);
    assert.equal((await runReminderSweep(at('2040-06-19T18:30:00Z'))).invoiceReminders, 1);
    assert.equal((await runReminderSweep(at('2040-06-19T20:00:00Z'))).invoiceReminders, 0, 'only once');
    const [n] = await ofType(a.user.id, 'invoice_due');
    assert.match(n.title, /^Invoice INV-0001 due in 1 day/);
    assert.match(n.body, /₹2,500\.00 still owed/);
    assert.deepEqual([n.entity.kind, String(n.entity.id)], ['invoice', i.id]);
    assert.equal((await runReminderSweep(at('2040-06-20T18:29:59Z'))).invoiceOverdue, 0);
    assert.equal((await runReminderSweep(at('2040-06-20T18:30:00Z'))).invoiceOverdue, 1);
    assert.equal((await runReminderSweep(at('2040-06-21T06:00:00Z'))).invoiceOverdue, 0);
    assert.equal((await ofType(a.user.id, 'invoice_overdue')).length, 1);
  });

  test('paid, cancelled and draft invoices send nothing; paying before the time cancels the reminder', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    const when = { issueDate: '2040-06-01', dueDate: '2040-06-20' };
    const paid = await issuedInvoice(a.token, {}, when);
    await inv.pay(a.token, paid.id, { amountMinor: 100_000, paidOn: day(0) });
    const cancelled = await issuedInvoice(a.token, {}, when);
    await inv.cancel(a.token, cancelled.id);
    await newInvoice(a.token, { dueDate: '2040-06-20' });
    const partly = await issuedInvoice(a.token, {}, when);
    await inv.pay(a.token, partly.id, { amountMinor: 1_000 });
    const stats = await runReminderSweep(at('2040-06-20T00:00:00Z'));
    assert.equal(stats.invoiceReminders, 1);
    const [n] = await ofType(a.user.id, 'invoice_due');
    assert.equal(String(n.entity.id), partly.id);
    assert.match(n.body, /\$990\.00 still owed/, 'only what is left');
    const stale = await runReminderSweep(at('2040-07-10T00:00:00Z'));
    assert.deepEqual([stale.invoiceReminders, stale.invoiceOverdue], [0, 0], 'long-dead invoices do not flood the bell');
  });

  test('moving the due date re-arms the reminder, and two sweeps at once send one', async () => {
    const a = await signUp();
    await setTimezone(a.token, 'UTC');
    const i = await issuedInvoice(a.token, {}, { issueDate: '2040-06-01', dueDate: '2040-06-20' });
    const both = await Promise.all([runReminderSweep(at('2040-06-20T00:00:00Z')), runReminderSweep(at('2040-06-20T00:00:00Z'))]);
    assert.equal(both.reduce((n, s) => n + s.invoiceReminders, 0), 1);
    await inv.patch(a.token, i.id, { dueDate: '2040-06-27' });
    assert.equal((await runReminderSweep(at('2040-06-27T00:00:00Z'))).invoiceReminders, 1);
    assert.equal((await ofType(a.user.id, 'invoice_due')).length, 2);
  });
});
