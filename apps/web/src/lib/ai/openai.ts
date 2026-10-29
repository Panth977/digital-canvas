/**
 * OpenAI: GPT through the Responses API (text, vision, JSON mode), images
 * with gpt-image (b64), videos with Sora (job + polling + download).
 * The API allows browser calls with the key (CORS checked).
 */
import { AIError, download, fromBase64, json, nearest, poll, report } from './http.ts';
import type { AdapterOptions, Cap, ChatRequest, ImageRequest, Media, ModelInfo, Provider, VideoRequest } from './types.ts';

export const OPENAI_API = 'https://api.openai.com/v1';
const NAME = 'OpenAI';

export const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', caps: ['text', 'vision', 'json'] },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', caps: ['text', 'vision', 'json'] },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', caps: ['text', 'vision', 'json'] },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', caps: ['text', 'vision', 'json'] },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', caps: ['image'] },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', caps: ['image'] },
  { id: 'sora-2', label: 'Sora 2', caps: ['video'] },
  { id: 'sora-2-pro', label: 'Sora 2 Pro', caps: ['video'] },
];

/** Capabilities from an OpenAI model id (the models endpoint lists ids only). */
export function openaiCaps(id: string): Cap[] | null {
  if (/^(gpt-image|dall-e|chatgpt-image)/.test(id)) return ['image'];
  if (/^sora/.test(id)) return ['video'];
  if (/(embedding|tts|transcribe|whisper|realtime|audio|moderation|search|davinci|babbage|instruct|codex|computer-use|live)/.test(id)) return null;
  if (/^(gpt-|o\d|chatgpt)/.test(id)) return ['text', 'vision', 'json'];
  return null;
}

/** gpt-image sizes. */
export function openaiImageSize(w: number, h: number): string {
  const r = w / h;
  return r > 1.2 ? '1536x1024' : r < 1 / 1.2 ? '1024x1536' : '1024x1024';
}

export function soraSize(model: string, w: number, h: number): string {
  const portrait = h > w;
  if (model.includes('pro')) return portrait ? '1080x1920' : '1920x1080';
  return portrait ? '720x1280' : '1280x720';
}

export const SORA_SECONDS = [4, 8, 12, 16, 20];

export class OpenAIProvider implements Provider {
  readonly kind = 'openai' as const;
  constructor(private o: AdapterOptions) {}

  private auth(): Record<string, string> {
    return { authorization: `Bearer ${this.o.key}` };
  }

  async listModels(): Promise<ModelInfo[]> {
    const r = await json<{ data?: { id: string }[] }>(this.o, NAME, `${OPENAI_API}/models`, { headers: this.auth() });
    const known = new Map(OPENAI_MODELS.map((m) => [m.id, m]));
    const out: ModelInfo[] = [];
    for (const m of r.data ?? []) {
      const caps = openaiCaps(m.id);
      if (caps) out.push(known.get(m.id) ?? { id: m.id, caps });
    }
    out.sort((a, b) => Number(known.has(b.id)) - Number(known.has(a.id)) || a.id.localeCompare(b.id));
    return out.length ? out : OPENAI_MODELS;
  }

  async test(): Promise<string> {
    const m = await this.listModels();
    return `Connected · ${m.length} models`;
  }

  async chat(req: ChatRequest): Promise<string> {
    const content = typeof req.content === 'string'
      ? [{ type: 'input_text', text: req.content }]
      : req.content.map((p) => (p.type === 'text' ? { type: 'input_text', text: p.text } : { type: 'input_image', image_url: `data:${p.mime};base64,${p.data}` }));
    const body: Record<string, unknown> = {
      model: req.model,
      instructions: req.system,
      input: [{ role: 'user', content }],
      max_output_tokens: req.maxTokens ?? 16000,
      store: false,
    };
    if (/^(gpt-[5-9]|o\d)/.test(req.model)) body.reasoning = { effort: req.effort ?? 'low' };
    if (req.json) body.text = { format: { type: 'json_object' } };
    const r = await json<{ status?: string; incomplete_details?: { reason?: string }; output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[]; error?: { message?: string } }>(this.o, NAME, `${OPENAI_API}/responses`, {
      method: 'POST',
      headers: { ...this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal ?? null,
    });
    const parts = (r.output ?? []).filter((x) => x.type === 'message').flatMap((x) => x.content ?? []);
    const refusal = parts.find((p) => p.type === 'refusal');
    if (refusal) throw new AIError(`The model declined: ${refusal.refusal ?? 'try wording it differently'}.`);
    const out = parts.flatMap((p) => (p.type === 'output_text' && p.text ? [p.text] : [])).join('').trim();
    if (r.status === 'incomplete' && r.incomplete_details?.reason === 'max_output_tokens') throw new AIError('The reply was cut off. Try a shorter request.');
    if (r.status === 'failed') throw new AIError(`OpenAI said: ${r.error?.message ?? 'the request failed'}`);
    if (!out) throw new AIError('The model sent back an empty reply.');
    return out;
  }

  async images(req: ImageRequest): Promise<Media[]> {
    report(req.onProgress, null, 'Generating…');
    const r = await json<{ data?: { b64_json?: string; url?: string }[] }>(this.o, NAME, `${OPENAI_API}/images/generations`, {
      method: 'POST',
      headers: { ...this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ model: req.model, prompt: req.prompt, n: req.count, size: openaiImageSize(req.aspect.w, req.aspect.h) }),
      signal: req.signal ?? null,
    });
    const out: Media[] = [];
    for (const d of r.data ?? []) {
      if (d.b64_json) out.push({ bytes: fromBase64(d.b64_json), mime: 'image/png' });
      else if (d.url) out.push(await download(this.o, NAME, d.url, {}, 'image/png'));
    }
    if (!out.length) throw new AIError('OpenAI sent back no image.');
    return out;
  }

  async video(req: VideoRequest): Promise<Media> {
    const size = soraSize(req.model, req.aspect.w, req.aspect.h);
    const form = new FormData();
    form.set('model', req.model);
    form.set('prompt', req.prompt);
    form.set('size', size);
    form.set('seconds', String(nearest(req.duration, SORA_SECONDS)));
    if (req.image) {
      // the reference must match the video size: fit it (cover) in the browser
      const [w, h] = size.split('x').map(Number) as [number, number];
      const ref = await coverTo(req.image, w, h);
      form.set('input_reference', new Blob([ref.bytes as BlobPart], { type: ref.mime }), 'reference.png');
    }
    report(req.onProgress, 0, 'Queued');
    const job = await json<{ id: string; status: string }>(this.o, NAME, `${OPENAI_API}/videos`, { method: 'POST', headers: this.auth(), body: form, signal: req.signal ?? null });
    await poll(this.o, async () => {
      const s = await json<{ status: string; progress?: number; error?: { message?: string } }>(this.o, NAME, `${OPENAI_API}/videos/${encodeURIComponent(job.id)}`, { headers: this.auth(), signal: req.signal ?? null });
      if (s.status === 'completed') return true;
      if (s.status === 'failed') throw new AIError(`Sora couldn't make this video: ${s.error?.message ?? 'it failed'}.`);
      report(req.onProgress, typeof s.progress === 'number' ? s.progress / 100 : null, s.status === 'queued' ? 'Queued' : 'Rendering');
      return null;
    }, { timeoutMs: 30 * 60_000, ...(req.signal ? { signal: req.signal } : {}) });
    report(req.onProgress, 1, 'Downloading');
    return download(this.o, NAME, `${OPENAI_API}/videos/${encodeURIComponent(job.id)}/content`, { headers: this.auth() }, 'video/mp4');
  }
}

/** Scale + centre-crop an image to exactly w×h (PNG). Browser only; tests pass through. */
export async function coverTo(img: Media, w: number, h: number): Promise<Media> {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return img;
  const bmp = await createImageBitmap(new Blob([img.bytes as BlobPart], { type: img.mime }));
  if (bmp.width === w && bmp.height === h) return img;
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  const s = Math.max(w / bmp.width, h / bmp.height);
  g.drawImage(bmp, (w - bmp.width * s) / 2, (h - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  const blob = await c.convertToBlob({ type: 'image/png' });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' };
}
