/**
 * OpenAI-compatible chat endpoints (`/chat/completions` + `/models`):
 * OpenRouter, Groq, Together, Mistral, DeepSeek, local Ollama / LM Studio,
 * or any base URL. JSON mode is asked for when wanted and dropped if the
 * endpoint refuses it. Images via `/images/generations` where the endpoint
 * has it (Together, many gateways), or OpenRouter's image-output chat models.
 */
import { AIError, download, fromBase64, fromDataUrl, json, nearestRatio, report } from './http.ts';
import type { AdapterOptions, Cap, ChatRequest, ImageRequest, Media, ModelInfo, Provider } from './types.ts';
import { openaiImageSize } from './openai.ts';

export const OPENROUTER_API = 'https://openrouter.ai/api/v1';

/** Presets for the "OpenAI-compatible" provider (base URL + where to get a key). */
export const COMPATIBLE_PRESETS: { id: string; label: string; baseUrl: string; keyUrl?: string; keyless?: boolean; note?: string }[] = [
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.ai/settings/api-keys' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'ollama', label: 'Ollama (this computer)', baseUrl: 'http://localhost:11434/v1', keyless: true, note: 'Start Ollama with OLLAMA_ORIGINS set to this site (or *) so the browser may call it.' },
  { id: 'lmstudio', label: 'LM Studio (this computer)', baseUrl: 'http://localhost:1234/v1', keyless: true, note: 'Turn on "Enable CORS" in LM Studio’s server settings.' },
  { id: 'custom', label: 'Other (any base URL)', baseUrl: '' },
];

export function compatCaps(id: string): Cap[] {
  if (/(embed|whisper|tts|rerank|guard|moderation)/i.test(id)) return [];
  if (/(flux|stable-diffusion|sdxl|imagen|image-gen|dall-e|gpt-image|seedream|recraft|ideogram)/i.test(id)) return ['image'];
  const vision = /(vision|vl\b|-vl|llava|gpt-4o|gpt-[5-9]|gemini|claude|pixtral|llama-?4|qwen.*vl|gemma-?3|mistral-(medium|small)|minicpm)/i.test(id);
  return vision ? ['text', 'vision', 'json'] : ['text', 'json'];
}

interface ChatChoice { message?: { content?: string | { type: string; text?: string }[] | null; refusal?: string | null; images?: { image_url?: { url?: string } }[] }; finish_reason?: string }

export class CompatibleProvider implements Provider {
  readonly kind: 'compatible' | 'openrouter' = 'compatible';
  protected name = 'OpenAI-compatible';
  constructor(protected o: AdapterOptions) {}

  protected get base(): string {
    const b = (this.o.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(b)) throw new AIError('Set the base URL of this endpoint first (e.g. https://api.groq.com/openai/v1).');
    return b;
  }

  protected headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...(this.o.key ? { authorization: `Bearer ${this.o.key}` } : {}) };
  }

  async listModels(): Promise<ModelInfo[]> {
    const r = await json<{ data?: { id: string; name?: string }[] }>(this.o, this.name, `${this.base}/models`, { headers: this.headers() });
    return (r.data ?? []).map((m) => ({ id: m.id, label: m.name ?? m.id, caps: compatCaps(m.id) })).filter((m) => m.caps.length);
  }

  async test(): Promise<string> {
    const m = await this.listModels();
    return `Connected · ${m.length} models`;
  }

  protected async completions(body: Record<string, unknown>, signal?: AbortSignal): Promise<ChatChoice> {
    const r = await json<{ choices?: ChatChoice[]; error?: unknown }>(this.o, this.name, `${this.base}/chat/completions`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: signal ?? null });
    const c = r.choices?.[0];
    if (!c) throw new AIError(`${this.name} sent back no answer.`);
    return c;
  }

  async chat(req: ChatRequest): Promise<string> {
    const user = typeof req.content === 'string'
      ? req.content
      : req.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } }));
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: user }],
      max_tokens: req.maxTokens ?? 8000,
    };
    let c: ChatChoice;
    if (req.json) {
      try {
        c = await this.completions({ ...body, response_format: { type: 'json_object' } }, req.signal);
      } catch (e) {
        // not every model/endpoint has JSON mode: ask again without it (the reply is still parsed leniently)
        if (!(e instanceof AIError) || e.status !== 400) throw e;
        c = await this.completions(body, req.signal);
      }
    } else c = await this.completions(body, req.signal);
    if (c.message?.refusal) throw new AIError(`The model declined: ${c.message.refusal}`);
    const content = c.message?.content;
    const out = (typeof content === 'string' ? content : (content ?? []).map((p) => p.text ?? '').join('')).trim();
    if (c.finish_reason === 'length') throw new AIError('The reply was cut off. Try a shorter request or a model with a longer output.');
    if (!out) throw new AIError('The model sent back an empty reply.');
    return out;
  }

  async images(req: ImageRequest): Promise<Media[]> {
    report(req.onProgress, null, 'Generating…');
    const r = await json<{ data?: { b64_json?: string; url?: string }[] }>(this.o, this.name, `${this.base}/images/generations`, {
      method: 'POST', headers: this.headers(), signal: req.signal ?? null,
      body: JSON.stringify({ model: req.model, prompt: req.prompt, n: req.count, size: openaiImageSize(req.aspect.w, req.aspect.h), response_format: 'b64_json' }),
    });
    const out: Media[] = [];
    for (const d of r.data ?? []) {
      if (d.b64_json) out.push({ bytes: fromBase64(d.b64_json), mime: 'image/png' });
      else if (d.url) out.push(fromDataUrl(d.url) ?? (await download(this.o, this.name, d.url, {}, 'image/png')));
    }
    if (!out.length) throw new AIError(`${this.name} sent back no image.`);
    return out;
  }
}

/**
 * OpenRouter: any model through one key. Model list (with modalities) from
 * its public `/models`; image models answer chat with `modalities: ["image","text"]`.
 */
export class OpenRouterProvider extends CompatibleProvider {
  override readonly kind = 'openrouter' as const;
  protected override name = 'OpenRouter';
  constructor(o: AdapterOptions) {
    super({ ...o, baseUrl: OPENROUTER_API });
  }

  protected override headers(): Record<string, string> {
    const site = typeof location !== 'undefined' ? location.origin : 'https://digital-canvas-p977.web.app';
    return { ...super.headers(), 'HTTP-Referer': site, 'X-Title': 'Digital Canvas' };
  }

  override async listModels(): Promise<ModelInfo[]> {
    const r = await json<{ data?: { id: string; name?: string; architecture?: { input_modalities?: string[]; output_modalities?: string[] } }[] }>(this.o, this.name, `${OPENROUTER_API}/models`, { headers: this.headers() });
    return (r.data ?? []).map((m) => {
      const inp = m.architecture?.input_modalities ?? ['text'], out = m.architecture?.output_modalities ?? ['text'];
      const caps: Cap[] = [];
      if (out.includes('text')) caps.push('text', 'json');
      if (out.includes('text') && inp.includes('image')) caps.push('vision');
      if (out.includes('image')) caps.push('image');
      if (out.includes('video')) caps.push('video');
      return { id: m.id, label: m.name ?? m.id, caps };
    }).filter((m) => m.caps.length);
  }

  /** The key's own record (`/key`): proves the key, not just the network. */
  override async test(): Promise<string> {
    const k = await json<{ data?: { label?: string; limit_remaining?: number | null } }>(this.o, this.name, `${OPENROUTER_API}/key`, { headers: this.headers() });
    const left = k.data?.limit_remaining;
    return `Connected${k.data?.label ? ` · ${k.data.label}` : ''}${typeof left === 'number' ? ` · $${left.toFixed(2)} left` : ''}`;
  }

  override async images(req: ImageRequest): Promise<Media[]> {
    const ratio = nearestRatio(req.aspect.w, req.aspect.h, ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
    let done = 0;
    report(req.onProgress, 0, 'Generating…');
    const one = async (): Promise<Media[]> => {
      const c = await this.completions({
        model: req.model, modalities: ['image', 'text'], image_config: { aspect_ratio: ratio },
        messages: [{ role: 'user', content: req.prompt }],
      }, req.signal);
      done++;
      report(req.onProgress, done / req.count, `${done} of ${req.count}`);
      const out: Media[] = [];
      for (const im of c.message?.images ?? []) {
        const url = im.image_url?.url ?? '';
        const m = fromDataUrl(url) ?? (url.startsWith('https://') ? await download(this.o, this.name, url, {}, 'image/png') : null);
        if (m) out.push(m);
      }
      return out;
    };
    const out = (await Promise.all(Array.from({ length: Math.max(1, req.count) }, one))).flat();
    if (!out.length) throw new AIError('OpenRouter sent back no image. Pick a model whose output includes images.');
    return out;
  }
}
