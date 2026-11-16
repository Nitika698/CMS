import { AppError } from '../../lib/errors.js';
import { aiConfig } from './ai.config.js';
import { createAnthropicProvider } from './providers/anthropic.provider.js';

/**
 * The ONLY door to a language-model vendor. The rest of the app talks to this contract and nothing else:
 *
 *   provider.chat({ system, messages, tools?, maxTokens? }) -> Promise<{
 *     text: string, toolCalls: { id, name, input }[], stopReason: string | null, usage: { inputTokens, outputTokens }
 *   }>
 *
 * `messages` are provider-neutral: { role: 'user'|'assistant', text, toolCalls? } and { role: 'tool', results: [{ id, content }] }.
 * To add another vendor: write providers/<vendor>.provider.js that returns an object with chat(), register it in FACTORIES,
 * and allow its name in PROVIDERS (ai.config.js). Nothing else changes.
 */
const FACTORIES = { anthropic: createAnthropicProvider };

let override = null; // tests inject a fake here
export const setProviderForTests = (p) => {
  override = p;
};
export const hasProviderOverride = () => override !== null;

export function getProvider() {
  if (override) return override;
  const cfg = aiConfig();
  if (!cfg.enabled) throw new AppError(503, 'AI_DISABLED', cfg.reason);
  return FACTORIES[cfg.provider](cfg);
}
