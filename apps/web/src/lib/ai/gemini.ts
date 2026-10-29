/**
 * Google Gemini API (key from AI Studio), through the Interactions API
 * (`/v1beta/interactions`): text, vision, JSON (response_format), images
 * (Nano Banana / Gemini image models) and video (Gemini Omni Flash; Veo 3.1
 * preview was shut down in the Gemini API on 2026-10-22).
 * Browser calls with `x-goog-api-key` pass CORS; the `Api-Revision` header
 * does NOT (preflight 403), so it is never sent.
 */
import { AIError, base64, download, fromBase64, json, nearestRatio, poll, report } from './http.ts';
import type { AdapterOptions, Cap, ChatPart, ChatRequest, ImageRequest, Media, ModelInfo, Provider, VideoRequest } from './types.ts';

export const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const NAME = 'Google Gemini';

export const GEMINI_MODELS: ModelInfo[] = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', caps: ['text', 'vision', 'json'] },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', caps: ['text', 'vision', 'json'] },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', caps: ['text', 'vision', 'json'] },
  { id: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1', caps: ['image'] },
  { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image', caps: ['image'] },
  { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', caps: ['image'] },
  { id: 'gemini-omni-1.1-flash', label: 'Gemini Omni 1.1 Flash (video)', caps: ['video'] },
];

export const GEMINI_IMAGE_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

export function geminiCaps(id: string, methods: string[] = []): Cap[] | null {
  if (/(embedding|tts|live|transcribe|robotics|aqa|translate|lyria|native-audio)/.test(id)) return null;
  if (/(omni|veo)/.test(id)) return ['video'];
  if (/(image|imagen|nano-banana)/.test(id)) return ['image'];
  if (/^(gemini|gemma)/.test(id) && (!methods.length || methods.some((m) => /generateContent|interact/i.test(m)))) return ['text', 'vision', 'json'];
  return null;
}

type Content = { type: string; text?: string; data?: string; uri?: string; mime_type?: string };
interface Interaction { id?: string; status?: string; steps?: { type: string; content?: Content[] }[]; outputs?: Content[]; error?: { message?: string } }

/** Everything the model produced (REST: `steps[].content` of model_output steps; older revisions: `outputs`). */
export function outputsOf(r: Interaction): Content[] {
  const fromSteps = (r.steps ?? []).filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []);
  return fromSteps.length ? fromSteps : (r.outputs ?? []);
}

export class GeminiProvider implements Provider {
  readonly kind = 'gemini' as const;
  constructor(private o: AdapterOptions) {}

  private headers(json = true): Record<string, string> {
    return { 'x-goog-api-key': this.o.key, ...(json ? { 'content-type': 'application/json' } : {}) };
  }

  private create(body: object, signal?: AbortSignal): Promise<Interaction> {
    return json<Interaction>(this.o, NAME, `${GEMINI_API}/interactions`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: signal ?? null });
  }

  async listModels(): Promise<ModelInfo[]> {
    const r = await json<{ models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] }>(this.o, NAME, `${GEMINI_API}/models?pageSize=1000`, { headers: this.headers(false) });
    const out: ModelInfo[] = [];
    for (const m of r.models ?? []) {
      const id = m.name.replace(/^models\//, '');
      const caps = geminiCaps(id, m.supportedGenerationMethods);
      if (caps) out.push({ id, label: m.displayName ?? id, caps });
    }
    for (const k of GEMINI_MODELS) if (!out.some((m) => m.id === k.id)) out.push(k);
    return out;
  }

  async test(): Promise<string> {
    const m = await this.listModels();
    return `Connected · ${m.length} models`;
  }

  private input(content: string | ChatPart[]): unknown {
    if (typeof content === 'string') return content;
    return content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image', data: p.data, mime_type: p.mime }));
  }

  async chat(req: ChatRequest): Promise<string> {
    const body: Record<string, unknown> = {
      model: req.model,
      input: this.input(req.content),
      system_instruction: req.system,
      store: false,
      generation_config: { thinking_level: req.effort === 'high' ? 'high' : 'low' },
    };
    if (req.json) body.response_format = { type: 'text', mime_type: 'application/json' };
    const r = await this.create(body, req.signal);
    if (r.status === 'failed') throw new AIError(`Gemini said: ${r.error?.message ?? 'the request failed'}`);
    const out = outputsOf(r).flatMap((c) => (c.type === 'text' && c.text ? [c.text] : [])).join('').trim();
    if (!out) throw new AIError('Gemini sent back an empty reply (it may have been blocked by a safety filter).');
    return out;
  }

  async images(req: ImageRequest): Promise<Media[]> {
    const ratio = nearestRatio(req.aspect.w, req.aspect.h, GEMINI_IMAGE_RATIOS);
    let done = 0;
    report(req.onProgress, 0, 'Generating…');
    const one = async (): Promise<Media[]> => {
      const r = await this.create({ model: req.model, input: req.prompt, store: false, response_format: { type: 'image', aspect_ratio: ratio } }, req.signal);
      done++;
      report(req.onProgress, done / req.count, `${done} of ${req.count}`);
      return outputsOf(r).flatMap((c) => (c.type === 'image' && c.data ? [{ bytes: fromBase64(c.data), mime: c.mime_type ?? 'image/png' }] : []));
    };
    const out = (await Promise.all(Array.from({ length: Math.max(1, req.count) }, one))).flat();
    if (!out.length) throw new AIError('Gemini sent back no image (it may have been blocked by a safety filter).');
    return out;
  }

  async video(req: VideoRequest): Promise<Media> {
    const prompt = `${req.prompt.trim()}\n\n(About ${Math.round(req.duration)} seconds long.)`;
    const input = req.image ? [{ type: 'image', data: base64(req.image.bytes), mime_type: req.image.mime }, { type: 'text', text: prompt }] : prompt;
    report(req.onProgress, null, 'Queued');
    const started = await this.create({
      model: req.model,
      input,
      background: true,
      response_format: { type: 'video', aspect_ratio: req.aspect.h > req.aspect.w ? '9:16' : '16:9', delivery: 'uri' },
    }, req.signal);
    const final = started.status === 'completed' ? started : await poll(this.o, async () => {
      const s = await json<Interaction>(this.o, NAME, `${GEMINI_API}/interactions/${encodeURIComponent(started.id ?? '')}`, { headers: this.headers(false), signal: req.signal ?? null });
      if (s.status === 'completed') return s;
      if (s.status === 'failed' || s.status === 'cancelled') throw new AIError(`Gemini couldn't make this video: ${s.error?.message ?? s.status}.`);
      report(req.onProgress, null, 'Rendering');
      return null;
    }, { timeoutMs: 30 * 60_000, first: 5000, ...(req.signal ? { signal: req.signal } : {}) });
    const v = outputsOf(final).find((c) => c.type === 'video');
    if (!v) throw new AIError('Gemini sent back no video.');
    if (v.data) return { bytes: fromBase64(v.data), mime: v.mime_type ?? 'video/mp4' };
    if (v.uri) {
      report(req.onProgress, 1, 'Downloading');
      // the key goes to the Gemini API host only, never to wherever a URI points
      const own = new URL(v.uri).host === new URL(GEMINI_API).host;
      return download(this.o, NAME, v.uri, own ? { headers: this.headers(false) } : {}, 'video/mp4');
    }
    throw new AIError('Gemini sent back no video.');
  }
}
