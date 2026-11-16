import { AppError } from '../../../lib/errors.js';

/**
 * Anthropic Messages API over plain fetch (no SDK dependency). Implements the provider contract in ai.provider.js:
 *   chat({ system, messages, tools, maxTokens }) -> { text, toolCalls, stopReason, usage }
 * The key is only ever placed in the request header here. Errors from the API are translated; their bodies are never
 * returned to users because they can echo request details.
 */
export class ProviderError extends AppError {}

const toWire = (messages) =>
  messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })) };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: [...(m.text ? [{ type: 'text', text: m.text }] : []), ...m.toolCalls.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input }))],
      };
    }
    return { role: m.role, content: m.text };
  });

export function createAnthropicProvider(cfg, fetchImpl = fetch) {
  return {
    name: 'anthropic',
    async chat({ system, messages, tools = [], maxTokens }) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
      let res;
      try {
        res = await fetchImpl(`${cfg.baseUrl}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: Math.min(maxTokens ?? cfg.maxOutputTokens, cfg.maxOutputTokens),
            system,
            messages: toWire(messages),
            ...(tools.length && { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) }),
          }),
          signal: ctrl.signal,
        });
      } catch (err) {
        if (err?.name === 'AbortError') throw new AppError(504, 'AI_TIMEOUT', 'The AI service took too long to answer. Try again.');
        throw new AppError(502, 'AI_PROVIDER_ERROR', 'The AI service could not be reached. Try again in a moment.');
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        // 401/403 means OUR key is wrong: an operator problem, not something the user can fix or should see details of.
        if (res.status === 429 || res.status === 529 || res.status === 503) throw new AppError(503, 'AI_BUSY', 'The AI service is busy right now. Try again in a minute.');
        throw new AppError(502, 'AI_PROVIDER_ERROR', 'The AI service could not complete that request.');
      }
      let body;
      try {
        body = await res.json();
      } catch {
        throw new AppError(502, 'AI_PROVIDER_ERROR', 'The AI service sent an unreadable answer.');
      }
      const blocks = Array.isArray(body.content) ? body.content : [];
      return {
        text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
        toolCalls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} })),
        stopReason: body.stop_reason ?? null,
        usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 },
      };
    },
  };
}
