/**
 * Generate image / Generate video: jobs that keep running while you edit
 * (state lives here, not in the panel). Results show as tiles; a click or a
 * drag puts one on the page. Each result is stored once (content hash) in
 * your Uploads (Drive `assets/`) and carries {provider, model, prompt} in
 * the design's asset meta.
 */
import { assetId } from '@digital-canvas/storage';
import type { AssetAI } from '@digital-canvas/scene';
import type { EditorState } from '../editor.svelte.ts';
import { driveLib } from '../drivelib.svelte.ts';
import { toast } from '../toast.svelte.ts';
import { aiSettings, type Choice } from './settings.svelte.ts';
import type { Media, Progress } from './types.ts';

export type MediaKind = 'image' | 'video';

export interface Job {
  id: string;
  kind: MediaKind;
  prompt: string;
  label: string;
  progress: Progress;
  error?: string;
  startedAt: number;
}

export interface Result {
  id: string;
  kind: MediaKind;
  bytes: Uint8Array;
  mime: string;
  url: string;
  ai: AssetAI;
  name: string;
  assetId: string;
}

export const STYLES = [
  { id: '', label: 'No style' },
  { id: 'photo', label: 'Photo', hint: 'a realistic photograph, natural light, high detail' },
  { id: 'illustration', label: 'Illustration', hint: 'a clean digital illustration' },
  { id: 'flat', label: 'Flat vector', hint: 'flat vector art, simple shapes, solid colours' },
  { id: '3d', label: '3D render', hint: 'a soft 3D render, studio lighting' },
  { id: 'watercolor', label: 'Watercolour', hint: 'a watercolour painting on paper' },
  { id: 'anime', label: 'Anime', hint: 'anime style artwork' },
  { id: 'cinematic', label: 'Cinematic', hint: 'a cinematic film still, dramatic lighting' },
] as const;

export function styledPrompt(prompt: string, style: string): string {
  const s = STYLES.find((x) => x.id === style);
  return s && 'hint' in s ? `${prompt.trim()}\n\nStyle: ${s.hint}.` : prompt.trim();
}

const shortName = (prompt: string, ext: string) => `AI ${prompt.trim().replace(/\s+/g, ' ').slice(0, 40)}.${ext}`;
const extOf = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/webm': 'webm', 'video/quicktime': 'mov' })[mime] ?? (mime.startsWith('video/') ? 'mp4' : 'png');

let seq = 0;

class MediaStudio {
  jobs = $state<Job[]>([]);
  results = $state<Result[]>([]);
  private controllers = new Map<string, AbortController>();

  private begin(kind: MediaKind, prompt: string, c: Choice): Job {
    const cfg = aiSettings.get(c.provider);
    const job: Job = { id: `job${++seq}`, kind, prompt, label: `${c.model} · ${cfg?.label ?? c.provider}`, progress: { fraction: null, message: 'Starting…' }, startedAt: Date.now() };
    this.jobs = [job, ...this.jobs];
    return job;
  }

  private patch(id: string, p: Partial<Job>): void {
    this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...p } : j));
  }

  private async keep(kind: MediaKind, media: Media, c: Choice, prompt: string): Promise<Result> {
    const cfg = aiSettings.get(c.provider);
    const ai: AssetAI = { provider: cfg?.kind ?? c.provider, model: c.model, prompt: prompt.slice(0, 2000), at: new Date().toISOString() };
    const id = await assetId(media.bytes, media.mime);
    const name = shortName(prompt, extOf(media.mime));
    const r: Result = { id: `r${++seq}`, kind, bytes: media.bytes, mime: media.mime, url: URL.createObjectURL(new Blob([media.bytes as BlobPart], { type: media.mime })), ai, name, assetId: id };
    this.results = [r, ...this.results];
    // into Uploads at once (once per content hash); offline or signed out it is stored when the design saves
    const store = driveLib.store;
    if (store) void store.addAsset(id, media.bytes, media.mime, name, undefined, ai).then(() => driveLib.stale()).catch(() => {});
    return r;
  }

  private async run(kind: MediaKind, prompt: string, work: (c: Choice, signal: AbortSignal, onProgress: (p: Progress) => void) => Promise<Media[]>): Promise<void> {
    const c = aiSettings.choice(kind);
    if (!c) throw new Error(`Add a provider that can make ${kind === 'image' ? 'images' : 'videos'} first (AI providers).`);
    const job = this.begin(kind, prompt, c);
    const ctl = new AbortController();
    this.controllers.set(job.id, ctl);
    try {
      const out = await work(c, ctl.signal, (p) => this.patch(job.id, { progress: p }));
      for (const m of out) await this.keep(kind, m, c, prompt);
      this.jobs = this.jobs.filter((j) => j.id !== job.id);
      toast.show(kind === 'image' ? `${out.length === 1 ? 'Your image is' : `${out.length} images are`} ready in the AI panel` : 'Your video is ready in the AI panel');
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') { this.jobs = this.jobs.filter((j) => j.id !== job.id); return; }
      this.patch(job.id, { error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.controllers.delete(job.id);
    }
  }

  generateImages(o: { prompt: string; style: string; aspect: { w: number; h: number }; count: number }): Promise<void> {
    const prompt = styledPrompt(o.prompt, o.style);
    return this.run('image', prompt, (c, signal, onProgress) => {
      const p = aiSettings.provider(c.provider);
      if (!p.images) throw new Error('This provider can’t make images.');
      return p.images({ model: c.model, prompt, aspect: o.aspect, count: o.count, signal, onProgress });
    });
  }

  generateVideo(o: { prompt: string; aspect: { w: number; h: number }; duration: number; image?: Media }): Promise<void> {
    return this.run('video', o.prompt, async (c, signal, onProgress) => {
      const p = aiSettings.provider(c.provider);
      if (!p.video) throw new Error('This provider can’t make videos.');
      return [await p.video({ model: c.model, prompt: o.prompt, aspect: o.aspect, duration: o.duration, ...(o.image ? { image: o.image } : {}), signal, onProgress })];
    });
  }

  cancel(id: string): void {
    this.controllers.get(id)?.abort();
    this.jobs = this.jobs.filter((j) => j.id !== id);
  }

  dismiss(id: string): void {
    const r = this.results.find((x) => x.id === id);
    if (r) URL.revokeObjectURL(r.url);
    this.results = this.results.filter((x) => x.id !== id);
  }

  /** Put a result on the page (at a drop point, or centred). */
  async insert(ed: EditorState, id: string, at?: { x: number; y: number }): Promise<boolean> {
    const r = this.results.find((x) => x.id === id);
    if (!r) return false;
    if (r.kind === 'video') return ed.addVideoBytes(r.bytes, r.mime, r.name, at, { ai: r.ai });
    const asset = await ed.addAsset(r.bytes, r.mime, r.name, { ai: r.ai });
    if (!asset) return false;
    ed.addImageAsset(asset, at);
    return true;
  }
}

export const studio = new MediaStudio();
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __aiStudio?: MediaStudio }).__aiStudio = studio;

export const AI_DRAG = 'ai';
