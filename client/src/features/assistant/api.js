import { api } from '../../lib/apiClient.js';

const post = (path, body) => api(`/ai/${path}`, { method: 'POST', body });

export const aiApi = {
  status: () => api('/ai/status'),
  ideas: (body) => post('ideas', body),
  copy: (body) => post('copy', body),
  campaignPlan: (body) => post('campaign-plan', body),
  summarize: (body) => post('summarize-communications', body),
  priorities: (body = {}) => post('task-priorities', body),
  ask: (body) => post('ask', body),
  actions: (status = 'pending') => api(`/ai/actions?status=${status}`),
  confirm: (id) => post(`actions/${id}/confirm`),
  dismiss: (id) => post(`actions/${id}/dismiss`),
};
