/**
 * Anthropic (Claude), straight from the browser: the Messages API allows it
 * with `anthropic-dangerous-direct-browser-access: true` (CORS checked).
 * Text + vision; JSON by instruction (the caller extracts and validates).
 */
import { AIError, json } from './http.ts';
import type { AdapterOptions, ChatRequest, ModelInfo, Provider } from './types.ts';

export const ANTHROPIC_API = 'https://api.anthropic.com/v1';
const NAME = 'Anthropic';

export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', caps: ['text', 'vision', 'json'] },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', caps: ['text', 'vision', 'json'] },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', caps: ['text', 'vision', 'json'] },
];

export class AnthropicProvider implements Provider {
  readonly kind = 'anthropic' as const;
  constructor(private o: AdapterOptions) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.o.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const r = await json<{ data?: { id: string; display_name?: string }[] }>(this.o, NAME, `${ANTHROPIC_API}/models?limit=100`, { headers: this.headers() });
    const got = (r.data ?? []).map((m) => ({ id: m.id, label: m.display_name ?? m.id, caps: ['text', 'vision', 'json'] as ModelInfo['caps'] }));
    return got.length ? got : ANTHROPIC_MODELS;
  }

  async test(): Promise<string> {
    const m = await this.listModels();
    return `Connected · ${m.length} models`;
  }

  async chat(req: ChatRequest): Promise<string> {
    const content = typeof req.content === 'string'
      ? req.content
      : req.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } }));
    const res = await json<{ content?: { type: string; text?: string }[]; stop_reason?: string }>(this.o, NAME, `${ANTHROPIC_API}/messages`, {
      method: 'POST',
      headers: { ...this.headers(), 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      signal: req.signal ?? null,
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: 'user', content }],
        output_config: { effort: req.effort ?? 'low' },
        // a declined request is retried on a fallback model chosen by the API
        fallbacks: 'default',
      }),
    });
    if (res.stop_reason === 'refusal') throw new AIError('Claude declined this request. Try wording it differently.');
    const out = (res.content ?? []).flatMap((b) => (b.type === 'text' && b.text ? [b.text] : [])).join('').trim();
    if (!out) throw new AIError('Claude sent back an empty reply.');
    if (res.stop_reason === 'max_tokens') throw new AIError('The reply was cut off. Try a shorter request.');
    return out;
  }
}
