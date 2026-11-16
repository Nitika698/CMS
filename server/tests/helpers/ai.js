import { app, bearer, request } from './app.js';
import { setProviderForTests } from '../../src/modules/ai/ai.provider.js';

export const KEY = 'sk-test-KEY-must-never-be-sent-to-anyone-0001';

/** A stand-in for the language model: records every request it receives and answers with whatever the test scripted. */
export class FakeProvider {
  constructor(handler) {
    this.handler = handler;
    this.calls = [];
  }

  async chat(req) {
    this.calls.push(JSON.parse(JSON.stringify(req)));
    const r = await this.handler(req, this.calls.length);
    return { text: '', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 50 }, ...r };
  }

  /** Everything the model was shown, as one string (system prompt, messages, tool results). */
  get seen() {
    return JSON.stringify(this.calls);
  }
}

export const json = (obj) => ({ text: JSON.stringify(obj) });
export const install = (handler) => {
  const p = new FakeProvider(handler);
  setProviderForTests(p);
  return p;
};
export const uninstall = () => setProviderForTests(null);

const base = '/api/v1/ai';
export const ai = {
  status: (token) => request(app).get(`${base}/status`).set(bearer(token)),
  post: (token, path, body = {}) => request(app).post(`${base}/${path}`).set(bearer(token)).send(body),
  actions: (token, q = '') => request(app).get(`${base}/actions${q ? `?${q}` : ''}`).set(bearer(token)),
  confirm: (token, id) => request(app).post(`${base}/actions/${id}/confirm`).set(bearer(token)),
  dismiss: (token, id) => request(app).post(`${base}/actions/${id}/dismiss`).set(bearer(token)),
};

export function configure(env = {}) {
  const keys = ['AI_API_KEY', 'AI_ENABLED', 'AI_DAILY_REQUEST_LIMIT', 'AI_RATE_LIMIT_PER_MINUTE', 'AI_MAX_OUTPUT_TOKENS', 'AI_PROVIDER', 'AI_MODEL'];
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, { AI_API_KEY: KEY, AI_DAILY_REQUEST_LIMIT: '1000', AI_RATE_LIMIT_PER_MINUTE: '1000', ...env });
}
export function reset() {
  uninstall();
  for (const k of ['AI_API_KEY', 'AI_ENABLED', 'AI_DAILY_REQUEST_LIMIT', 'AI_RATE_LIMIT_PER_MINUTE', 'AI_MAX_OUTPUT_TOKENS', 'AI_PROVIDER', 'AI_MODEL']) delete process.env[k];
}
