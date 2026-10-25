import { api, download } from '../../lib/apiClient.js';

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const invoicesApi = {
  meta: () => api('/invoices/meta'),
  context: (campaign) => api(`/invoices/context?campaign=${campaign}`),
  list: (params, signal) => api(`/invoices${qs(params)}`, { signal }),
  get: (id, signal) => api(`/invoices/${id}`, { signal }),
  create: (body) => api('/invoices', { method: 'POST', body }),
  update: (id, body) => api(`/invoices/${id}`, { method: 'PATCH', body }),
  remove: (id) => api(`/invoices/${id}`, { method: 'DELETE' }),
  issue: (id, body = {}) => api(`/invoices/${id}/issue`, { method: 'POST', body }),
  revert: (id) => api(`/invoices/${id}/revert`, { method: 'POST' }),
  cancel: (id, reason) => api(`/invoices/${id}/cancel`, { method: 'POST', body: reason ? { reason } : {} }),
  addPayment: (id, body) => api(`/invoices/${id}/payments`, { method: 'POST', body }),
  updatePayment: (id, pid, body) => api(`/invoices/${id}/payments/${pid}`, { method: 'PATCH', body }),
  removePayment: (id, pid) => api(`/invoices/${id}/payments/${pid}`, { method: 'DELETE' }),
  /** Saves the invoice document to the user's computer. Downloading does not change the invoice in any way. */
  async downloadFile(id) {
    const { blob, name } = await download(`/invoices/${id}/download`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};
