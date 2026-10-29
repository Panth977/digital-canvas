/**
 * kie.ai: a broker for image and video models (Market API). Every model is a
 * job: POST /api/v1/jobs/createTask {model, input} → taskId; poll
 * GET /api/v1/jobs/recordInfo?taskId= until state is success | fail;
 * resultJson = {"resultUrls": [...]} (files kept 14 days; hosts send CORS *).
 * Image-to-video needs a URL: the picture is uploaded first with
 * POST /api/file-base64-upload (deleted after 24 h).
 * Errors come as HTTP 200 with a non-200 `code` in the body.
 * Browser calls pass CORS. kie.ai's docs advise keeping keys server-side;
 * here the key is the user's own and stays in their browser.
 */
import { AIError, base64, download, json, nearest, nearestRatio, poll, report } from './http.ts';
import type { AdapterOptions, ImageRequest, Media, ModelInfo, Provider, VideoRequest } from './types.ts';

export const KIE_API = 'https://api.kie.ai';
const NAME = 'kie.ai';

interface Ctx { prompt: string; aspect: { w: number; h: number }; duration: number; imageUrl?: string }
interface KieModel extends ModelInfo {
  input: (c: Ctx) => Record<string, unknown>;
  /** Image-to-video variant used when a picture is given. */
  fromImage?: string;
  durations?: number[];
}

const R = (c: Ctx, list: string[]) => nearestRatio(c.aspect.w, c.aspect.h, list);
const ALL = ['1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9'];

export const KIE_MODELS: KieModel[] = [
  // images
  { id: 'google/nano-banana', label: 'Nano Banana (Google)', caps: ['image'], input: (c) => ({ prompt: c.prompt, aspect_ratio: R(c, ALL), output_format: 'png' }) },
  { id: 'seedream/4.5-text-to-image', label: 'Seedream 4.5', caps: ['image'], input: (c) => ({ prompt: c.prompt, aspect_ratio: R(c, ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9']), quality: 'basic' }) },
  { id: 'gpt-image-2-text-to-image', label: 'GPT Image 2', caps: ['image'], input: (c) => ({ prompt: c.prompt, aspect_ratio: R(c, ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9']) }) },
  { id: 'google/imagen4-fast', label: 'Imagen 4 Fast', caps: ['image'], input: (c) => ({ prompt: c.prompt, aspect_ratio: R(c, ['1:1', '16:9', '9:16', '3:4', '4:3']) }) },
  // videos
  {
    id: 'grok-imagine/text-to-video', label: 'Grok Imagine video', caps: ['video'], fromImage: 'grok-imagine/image-to-video', durations: [6, 10, 15, 20, 30],
    input: (c) => ({ prompt: c.prompt, aspect_ratio: R(c, ['2:3', '3:2', '1:1', '16:9', '9:16']), mode: 'normal', duration: Math.min(30, Math.max(6, Math.round(c.duration))), resolution: '720p', ...(c.imageUrl ? { image_urls: [c.imageUrl] } : {}) }),
  },
  {
    id: 'kling-2.6/text-to-video', label: 'Kling 2.6', caps: ['video'], fromImage: 'kling-2.6/image-to-video', durations: [5, 10],
    input: (c) => ({ prompt: c.prompt, sound: false, duration: String(nearest(c.duration, [5, 10])), ...(c.imageUrl ? { image_urls: [c.imageUrl] } : { aspect_ratio: R(c, ['1:1', '16:9', '9:16']) }) }),
  },
];

interface Envelope<T> { code: number; msg?: string; data?: T }

export class KieProvider implements Provider {
  readonly kind = 'kie' as const;
  constructor(private o: AdapterOptions) {}

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.o.key}`, 'content-type': 'application/json' };
  }

  /** kie answers 200 with the real status in `code`. */
  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await json<Envelope<T>>(this.o, NAME, `${KIE_API}${path}`, { ...init, headers: this.headers() });
    if (r.code !== 200) {
      const msg = r.msg ?? 'request failed';
      if (r.code === 401) throw new AIError(`kie.ai refused that API key (${msg}). Check it in AI providers.`, 401);
      if (r.code === 402) throw new AIError('kie.ai: not enough credits on this account.', 402);
      if (r.code === 429) throw new AIError('kie.ai: too many requests right now. Try again in a minute.', 429);
      throw new AIError(`kie.ai said: ${msg}`, r.code);
    }
    return r.data as T;
  }

  async listModels(): Promise<ModelInfo[]> {
    return KIE_MODELS.map(({ id, label, caps }) => ({ id, ...(label ? { label } : {}), caps }));
  }

  async test(): Promise<string> {
    const credits = await this.call<number>('/api/v1/chat/credit');
    return `Connected · ${credits} credits`;
  }

  private model(id: string): KieModel {
    return KIE_MODELS.find((m) => m.id === id) ?? { id, caps: ['image', 'video'], input: (c) => ({ prompt: c.prompt, aspect_ratio: R(c, ALL), ...(c.imageUrl ? { image_urls: [c.imageUrl] } : {}) }) };
  }

  /** createTask → poll → result URLs. */
  async run(model: string, input: Record<string, unknown>, o: { signal?: AbortSignal; onProgress?: ImageRequest['onProgress']; timeoutMs: number }): Promise<string[]> {
    const { taskId } = await this.call<{ taskId: string }>('/api/v1/jobs/createTask', { method: 'POST', body: JSON.stringify({ model, input }), signal: o.signal ?? null });
    report(o.onProgress, 0, 'Queued');
    return poll(this.o, async () => {
      const d = await this.call<{ state: string; resultJson?: string; failMsg?: string; failCode?: string; progress?: number }>(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { signal: o.signal ?? null });
      if (d.state === 'success') {
        let res: { resultUrls?: string[] } = {};
        try { res = JSON.parse(d.resultJson ?? '{}'); } catch { /* below */ }
        if (!res.resultUrls?.length) throw new AIError('kie.ai finished but sent no files.');
        return res.resultUrls;
      }
      if (d.state === 'fail') throw new AIError(`kie.ai couldn't make it: ${d.failMsg || `error ${d.failCode ?? ''}`}`.trim());
      report(o.onProgress, typeof d.progress === 'number' ? d.progress / 100 : null, d.state === 'generating' ? 'Generating' : 'Queued');
      return null;
    }, { timeoutMs: o.timeoutMs, ...(o.signal ? { signal: o.signal } : {}) });
  }

  async images(req: ImageRequest): Promise<Media[]> {
    const m = this.model(req.model);
    const runs = await Promise.all(Array.from({ length: Math.max(1, req.count) }, () =>
      this.run(m.id, m.input({ prompt: req.prompt, aspect: req.aspect, duration: 0 }), { timeoutMs: 10 * 60_000, ...(req.signal ? { signal: req.signal } : {}), ...(req.onProgress ? { onProgress: req.onProgress } : {}) })));
    report(req.onProgress, 1, 'Downloading');
    return Promise.all(runs.flat().map((u) => download(this.o, NAME, u, {}, 'image/png')));
  }

  /** A picture → a short-lived URL kie's models can read. */
  async upload(img: Media, signal?: AbortSignal): Promise<string> {
    const ext = img.mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
    const d = await this.call<{ downloadUrl: string }>('/api/file-base64-upload', {
      method: 'POST', signal: signal ?? null,
      body: JSON.stringify({ base64Data: `data:${img.mime};base64,${base64(img.bytes)}`, uploadPath: 'digital-canvas', fileName: `ref-${Date.now()}.${ext}` }),
    });
    return d.downloadUrl;
  }

  async video(req: VideoRequest): Promise<Media> {
    const base = this.model(req.model);
    let imageUrl: string | undefined;
    if (req.image) {
      report(req.onProgress, null, 'Uploading picture');
      imageUrl = await this.upload(req.image, req.signal);
    }
    const id = imageUrl && base.fromImage ? base.fromImage : base.id;
    const urls = await this.run(id, base.input({ prompt: req.prompt, aspect: req.aspect, duration: req.duration, ...(imageUrl ? { imageUrl } : {}) }), { timeoutMs: 30 * 60_000, ...(req.signal ? { signal: req.signal } : {}), ...(req.onProgress ? { onProgress: req.onProgress } : {}) });
    report(req.onProgress, 1, 'Downloading');
    return download(this.o, NAME, urls[0]!, {}, 'video/mp4');
  }
}

/** Durations a kie video model takes (for the UI). */
export const kieDurations = (id: string) => KIE_MODELS.find((m) => m.id === id)?.durations;
