import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { noStore } from '../../middleware/security.js';
import { validate } from '../../middleware/validate.js';
import { toPublicBusinessProfile } from '../users/user.model.js';
import {
  cancelInvoiceSchema, contextQuerySchema, createInvoiceSchema, createPaymentSchema, issueInvoiceSchema, listInvoicesQuerySchema, updateInvoiceSchema,
  updatePaymentSchema,
} from './invoices.schemas.js';
import { invoiceFilename, renderInvoiceHtml } from './invoice.render.js';
import * as service from './invoices.service.js';

const router = Router();
router.use(noStore, authenticate);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// The user comes from the verified session (never from the request).
const user = (req) => {
  const d = req.user.doc;
  return { id: req.user.id, name: d.name, email: d.email, timezone: d.timezone, defaultCurrency: d.defaultCurrency, businessProfile: toPublicBusinessProfile(d.businessProfile) };
};
const data = (fn, status = 200) => wrap(async (req, res) => res.status(status).json({ data: await fn(user(req), req) }));

router.get('/meta', (_req, res) => res.json(service.invoiceMeta()));
router.get('/context', validate({ query: contextQuerySchema }), data((u, req) => service.campaignContext(u, req.query.campaign)));

router.get('/', validate({ query: listInvoicesQuerySchema }), wrap(async (req, res) => res.json(await service.listInvoices(user(req), req.query))));
router.post('/', validate({ body: createInvoiceSchema }), data((u, req) => service.createInvoice(u, req.body), 201));

router.get('/:id', data((u, req) => service.getInvoice(u, req.params.id)));
router.patch('/:id', validate({ body: updateInvoiceSchema }), data((u, req) => service.updateInvoice(u, req.params.id, req.body)));
router.delete('/:id', wrap(async (req, res) => res.json(await service.deleteInvoice(user(req), req.params.id))));

// Reading or downloading never changes an invoice. The file is a document, not a receipt.
router.get('/:id/download', wrap(async (req, res) => {
  const inv = await service.invoiceForDocument(user(req), req.params.id);
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `attachment; filename="${invoiceFilename(inv.number)}"`,
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(renderInvoiceHtml(inv));
}));

router.post('/:id/issue', validate({ body: issueInvoiceSchema }), data((u, req) => service.issueInvoice(u, req.params.id, req.body)));
router.post('/:id/revert', data((u, req) => service.revertToDraft(u, req.params.id)));
router.post('/:id/cancel', validate({ body: cancelInvoiceSchema }), data((u, req) => service.cancelInvoice(u, req.params.id, req.body)));

// Payments received against an invoice (recorded by you; nothing is charged or collected here).
router.post('/:id/payments', validate({ body: createPaymentSchema }), data((u, req) => service.addPayment(u, req.params.id, req.body), 201));
router.patch('/:id/payments/:pid', validate({ body: updatePaymentSchema }), data((u, req) => service.updatePayment(u, req.params.id, req.params.pid, req.body)));
router.delete('/:id/payments/:pid', data((u, req) => service.deletePayment(u, req.params.id, req.params.pid)));

export default router;
