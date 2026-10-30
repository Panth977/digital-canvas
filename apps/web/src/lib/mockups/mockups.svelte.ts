/**
 * Mockups in the editor: the library (`/mockups/index.json`, see
 * packages/render/src/mockup.ts for the format) and a client for the
 * compositing worker. The page is rendered here (CanvasKit lives on the main
 * thread) and handed to the worker once per edit; the worker composites it
 * onto every mockup asked for.
 */
import { MOCKUP_SMALL, mockupFiles, parseMockupIndex, type MockupEntry, type Rgba } from '@digital-canvas/render/mockup';
import type { EditorState } from '../editor.svelte.ts';
import { MockupEngine, type MockupSize, type RenderRequest } from './engine.ts';

export { MOCKUP_CATEGORIES } from '@digital-canvas/render/mockup';
export type { MockupEntry };

export const MOCKUPS_BASE = new URL(`${import.meta.env.BASE_URL}mockups/`, location.origin).href;

export const thumbUrl = (e: MockupEntry) => new URL(mockupFiles(e).thumb, MOCKUPS_BASE).href;

class MockupLibrary {
  /** loading → ready (has mockups) | empty (no index or no entries) | error (network). */
  status = $state<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  list = $state.raw<MockupEntry[]>([]);
  error = $state('');

  async load(force = false): Promise<void> {
    if (!force && (this.status === 'loading' || this.status === 'ready')) return;
    this.status = 'loading';
    try {
      const res = await fetch(new URL('index.json', MOCKUPS_BASE), { cache: force ? 'reload' : 'default' });
      // a missing file comes back as 404, or as the app's index.html from SPA hosting
      if (res.status === 404 || !(res.headers.get('content-type') ?? '').includes('json')) {
        this.list = [];
        this.status = 'empty';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.list = parseMockupIndex(await res.json());
      this.status = this.list.length ? 'ready' : 'empty';
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.status = 'error';
    }
  }
}

export const mockupLib = new MockupLibrary();

// ---- compositing client ----

interface Reply { id: number; ok: boolean; width: number; height: number; data: Uint8ClampedArray; ms: number; error?: string }

class MockupClient {
  private worker: Worker | null = null;
  private local: MockupEngine | null = null;
  private seq = 0;
  private waiting = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();
  /** At most this many renders in the worker at once (the grid asks for many). */
  private running = 0;
  private queue: (() => void)[] = [];

  private start(): void {
    if (this.worker || this.local) return;
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'digital-canvas-mockups' });
      this.worker.onmessage = (e: MessageEvent<Reply>) => {
        const w = this.waiting.get(e.data.id);
        if (!w) return;
        this.waiting.delete(e.data.id);
        if (e.data.ok) w.resolve(e.data); else w.reject(new Error(e.data.error ?? 'mockup failed'));
      };
      this.worker.postMessage({ type: 'init', base: MOCKUPS_BASE });
    } catch {
      this.worker = null;
      this.local = new MockupEngine(MOCKUPS_BASE);
    }
  }

  /** Hand the worker a rendered page under `key` (the buffer is transferred). */
  setDesign(key: string, d: Rgba): void {
    this.start();
    if (this.worker) this.worker.postMessage({ type: 'design', key, design: d }, [d.data.buffer as ArrayBuffer]);
    else this.local!.setDesign(key, d);
  }

  render(req: RenderRequest): Promise<{ width: number; height: number; data: Uint8ClampedArray; ms: number }> {
    this.start();
    return new Promise((resolve, reject) => {
      const go = () => {
        this.running++;
        const done = () => { this.running--; this.queue.shift()?.(); };
        const p = this.worker
          ? new Promise<Reply>((res, rej) => {
            const id = ++this.seq;
            this.waiting.set(id, { resolve: res, reject: rej });
            this.worker!.postMessage({ type: 'render', id, req: $state.snapshot(req) });
          })
          : this.local!.render(req);
        p.then((r) => { done(); resolve(r); }, (e) => { done(); reject(e); });
      };
      // the preview dialog jumps the queue
      if (this.running < 3) go(); else if (req.size === 'full') this.queue.unshift(go); else this.queue.push(go);
    });
  }
}

export const mockupClient = new MockupClient();

/** Pixel size of the page for a mockup render: about the mockup's long side (small: the grid size, a bit over for sharpness). */
export function designPx(ed: EditorState, size: MockupSize, entry?: MockupEntry): { w: number; h: number } {
  const long = size === 'small' ? Math.round(MOCKUP_SMALL * 1.25) : Math.max(entry?.width ?? 1600, entry?.height ?? 1600);
  const s = Math.min(4, long / Math.max(ed.doc.width, ed.doc.height));
  return { w: Math.max(1, Math.round(ed.doc.width * s)), h: Math.max(1, Math.round(ed.doc.height * s)) };
}

/** Render a page and give it to the compositor under `key`. */
export function sendPage(ed: EditorState, pageId: string, key: string, px: { w: number; h: number }): void {
  const d = ed.pageRgba(pageId, px.w, px.h);
  mockupClient.setDesign(key, d);
}

/** Put RGBA on a canvas (resizing it). */
export function paint(canvas: HTMLCanvasElement, r: { width: number; height: number; data: Uint8ClampedArray }): void {
  if (canvas.width !== r.width) canvas.width = r.width;
  if (canvas.height !== r.height) canvas.height = r.height;
  canvas.getContext('2d')!.putImageData(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0);
}
