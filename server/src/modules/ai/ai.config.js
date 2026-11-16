/**
 * AI settings, read from the environment on every call (so tests and operators can change them without a restart
 * of this module). The API key never leaves the server: it is never logged, never returned, and never sent to the browser.
 *
 *   AI_API_KEY               provider key. No key = AI is off and every AI route answers 503 AI_DISABLED.
 *   AI_ENABLED               set to "false" to switch AI off even when a key exists.
 *   AI_PROVIDER              "anthropic" (default). New providers plug in at providers/ and ai.provider.js.
 *   AI_MODEL                 model id (default claude-sonnet-5-5)
 *   AI_BASE_URL              override the provider's API address (proxies, gateways)
 *   AI_MAX_OUTPUT_TOKENS     cap on tokens the model may write per call (default 1200, max 4000)
 *   AI_TIMEOUT_MS            give up on the provider after this long (default 30000)
 *   AI_DAILY_REQUEST_LIMIT   AI requests per user per day (UTC), default 100
 *   AI_RATE_LIMIT_PER_MINUTE AI requests per user per minute, default 10
 */
const int = (v, fallback, min, max) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const PROVIDERS = ['anthropic'];

export function aiConfig(env = process.env) {
  const key = (env.AI_API_KEY ?? '').trim();
  const provider = (env.AI_PROVIDER ?? 'anthropic').trim().toLowerCase();
  const switchedOff = (env.AI_ENABLED ?? '').trim().toLowerCase() === 'false';
  let reason = null;
  if (switchedOff) reason = 'AI is switched off (AI_ENABLED=false).';
  else if (!key) reason = 'No AI provider key is configured (AI_API_KEY).';
  else if (!PROVIDERS.includes(provider)) reason = `Unknown AI provider "${provider}".`;
  return {
    enabled: reason === null,
    reason,
    provider,
    apiKey: key,
    model: (env.AI_MODEL ?? '').trim() || 'claude-sonnet-5-5',
    baseUrl: ((env.AI_BASE_URL ?? '').trim() || 'https://api.anthropic.com').replace(/\/+$/, ''),
    maxOutputTokens: int(env.AI_MAX_OUTPUT_TOKENS, 1200, 100, 4000),
    timeoutMs: int(env.AI_TIMEOUT_MS, 30_000, 1000, 120_000),
    dailyLimit: int(env.AI_DAILY_REQUEST_LIMIT, 100, 1, 100_000),
    perMinute: int(env.AI_RATE_LIMIT_PER_MINUTE, 10, 1, 1000),
    maxToolRounds: 4,
  };
}

/** What the browser may know. Never includes the key. */
export function publicStatus(cfg = aiConfig(), override = false) {
  const enabled = cfg.enabled || override;
  return {
    enabled,
    reason: enabled ? null : cfg.reason,
    provider: enabled ? cfg.provider : null,
    model: enabled ? cfg.model : null,
    limits: { dailyRequests: cfg.dailyLimit, perMinute: cfg.perMinute, maxOutputTokens: cfg.maxOutputTokens },
  };
}
