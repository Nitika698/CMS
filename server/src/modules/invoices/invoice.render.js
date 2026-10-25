/**
 * The downloadable invoice: one self-contained HTML file (no scripts, no external requests) that prints cleanly
 * and can be saved as a PDF from any browser. Every value that came from a user is escaped.
 * It is a document about an invoice. Downloading it records nothing and never changes a status.
 */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lines = (v) => esc(v).replace(/\r?\n/g, '<br>');

const exponent = (currency) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
};
export function money(minor, currency) {
  const e = exponent(currency);
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: e, maximumFractionDigits: e }).format(minor / 10 ** e);
  } catch {
    return `${(minor / 10 ** e).toFixed(e)} ${currency}`;
  }
}
const dayText = (ymd) => (ymd ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${ymd}T00:00:00Z`)) : '—');
const num = (n) => new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(n);

const WATERMARK = { draft: 'DRAFT', void: 'CANCELLED' };
const STATE_NOTE = {
  draft: 'Draft: not issued yet.',
  void: 'This invoice has been cancelled.',
  paid: 'Paid in full, according to the payments recorded below.',
};

function partyBlock(title, p) {
  if (!p) return '';
  const rows = [
    p.name && `<strong>${esc(p.name)}</strong>`,
    p.contactName && esc(p.contactName),
    p.address && lines(p.address),
    p.email && esc(p.email),
    p.phone && esc(p.phone),
    p.website && esc(p.website),
    p.taxId && `${esc(p.taxIdLabel || 'Tax ID')}: ${esc(p.taxId)}`,
  ].filter(Boolean);
  return `<div class="party"><h3>${esc(title)}</h3><p>${rows.join('<br>')}</p></div>`;
}

export function renderInvoiceHtml(inv) {
  const cur = inv.currency;
  const m = (n) => esc(money(n, cur));
  const mark = WATERMARK[inv.status];
  const rows = inv.lineItems
    .map(
      (l) => `<tr><td>${esc(l.description)}</td><td class="r">${esc(num(l.quantity))}</td><td class="r">${m(l.unitAmountMinor)}</td><td class="r">${l.taxRatePct ? `${esc(num(l.taxRatePct))}%` : '—'}</td><td class="r">${m(l.amountMinor)}</td></tr>`,
    )
    .join('');
  const payments = inv.payments
    .map((p) => `<tr><td>${esc(dayText(p.paidOn))}</td><td>${esc(p.kindLabel)}${p.methodLabel ? ` · ${esc(p.methodLabel)}` : ''}${p.reference ? ` · ${esc(p.reference)}` : ''}</td><td class="r">${m(p.amountMinor)}</td></tr>`)
    .join('');
  const status = inv.status === 'sent' ? inv.displayLabel : inv.statusLabel;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${esc(inv.number)}</title>
<style>
  *{box-sizing:border-box}body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0;background:#f8fafc}
  .page{max-width:800px;margin:24px auto;background:#fff;padding:48px;position:relative;border:1px solid #e2e8f0}
  .mark{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:96px;font-weight:700;color:rgba(100,116,139,.12);transform:rotate(-20deg);pointer-events:none}
  header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}h1{margin:0;font-size:28px;letter-spacing:.04em}
  .meta{text-align:right}.meta p{margin:2px 0}.badge{display:inline-block;margin-top:6px;padding:2px 10px;border-radius:999px;background:#f1f5f9;font-weight:600;font-size:12px}
  .parties{display:flex;gap:32px;margin:32px 0}.party{flex:1}.party h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:.06em}.party p{margin:0}
  table{width:100%;border-collapse:collapse;margin:8px 0 16px}th{font-size:12px;text-transform:uppercase;color:#64748b;text-align:left;border-bottom:2px solid #e2e8f0;padding:8px 6px}
  td{padding:8px 6px;border-bottom:1px solid #f1f5f9;vertical-align:top}.r{text-align:right;white-space:nowrap}
  .totals{margin-left:auto;width:320px}.totals td{border:0;padding:4px 6px}.totals .grand td{font-weight:700;border-top:2px solid #0f172a;font-size:16px}
  h2{font-size:13px;text-transform:uppercase;color:#64748b;letter-spacing:.06em;margin:28px 0 6px}
  .box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px}.note{color:#475569;font-size:12px;margin-top:28px}
  @media print{body{background:#fff}.page{border:0;margin:0;padding:0;max-width:none}}
</style></head><body><div class="page">
${mark ? `<div class="mark">${mark}</div>` : ''}
<header>
  <div><h1>INVOICE</h1>${STATE_NOTE[inv.displayStatus] ? `<p>${esc(STATE_NOTE[inv.displayStatus])}</p>` : ''}</div>
  <div class="meta">
    <p><strong>${esc(inv.number)}</strong></p>
    <p>Issued: ${esc(dayText(inv.issueDay))}</p>
    <p>Due: ${esc(dayText(inv.dueDay))}</p>
    ${inv.campaign?.title ? `<p>Campaign: ${esc(inv.campaign.title)}</p>` : ''}
    <span class="badge">${esc(status)}</span>
  </div>
</header>
<div class="parties">${partyBlock('From', inv.issuer)}${partyBlock('Bill to', inv.billTo)}</div>
<table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Tax</th><th class="r">Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No lines yet.</td></tr>'}</tbody></table>
<table class="totals"><tbody>
  <tr><td>Subtotal</td><td class="r">${m(inv.subtotalMinor)}</td></tr>
  <tr><td>Tax</td><td class="r">${m(inv.taxMinor)}</td></tr>
  <tr class="grand"><td>Total (${esc(cur)})</td><td class="r">${m(inv.totalMinor)}</td></tr>
  ${inv.payments.length ? `<tr><td>Received</td><td class="r">−${m(inv.paidMinor)}</td></tr>` : ''}
  ${inv.status === 'sent' ? `<tr class="grand"><td>Balance due</td><td class="r">${m(inv.balanceMinor)}</td></tr>` : ''}
</tbody></table>
${inv.payments.length ? `<h2>Payments recorded</h2><table><thead><tr><th>Date</th><th>Details</th><th class="r">Amount</th></tr></thead><tbody>${payments}</tbody></table>` : ''}
${inv.paymentInstructions ? `<h2>Payment instructions</h2><div class="box">${lines(inv.paymentInstructions)}</div>` : ''}
${inv.notes ? `<h2>Notes</h2><p>${lines(inv.notes)}</p>` : ''}
<p class="note">Amounts are in ${esc(cur)}. The balance shown reflects the payments recorded by the issuer; a downloaded or emailed copy does not by itself mean this invoice has been paid.</p>
</div></body></html>`;
}

export const invoiceFilename = (number) => `invoice-${String(number).replace(/[^A-Za-z0-9._-]/g, '_')}.html`;
