/**
 * The page side of the thumbnail worker (worker.ts): one worker per tab,
 * shared by every open design. Fonts and pictures are content-addressed, so
 * each goes over once. Falls back to the main thread when there is no worker.
 */
import type { Doc } from '@digital-canvas/scene';
import type { FontLibrary } from '@digital-canvas/render';

let worker: Worker | null | undefined;
let seq = 0;
const waits = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();
const sentImages = new Set<string>();
const sentFaces = new WeakMap<FontLibrary, number>();

function get(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'digital-canvas-thumbs' });
    worker.onmessage = (e: MessageEvent<{ type: 'done' | 'failed'; id: number; bytes?: Uint8Array; error?: string }>) => {
      const w = waits.get(e.data.id);
      waits.delete(e.data.id);
      if (e.data.type === 'done') w?.resolve(e.data.bytes!);
      else w?.reject(new Error(e.data.error ?? 'thumbnail failed'));
    };
    worker.onerror = () => {
      for (const w of waits.values()) w.reject(new Error('thumbnail worker failed'));
      waits.clear();
      worker?.terminate();
      worker = null; // main-thread fallback from now on
    };
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Render a page as a PNG in the worker. `assets`/`fonts` are the editor's: what
 * the worker hasn't seen yet goes first. Resolves null when no worker can run
 * (the caller then renders on the main thread).
 */
export async function renderInWorker(doc: Doc, pageId: string, scale: number, assets: Map<string, Uint8Array>, fonts: FontLibrary): Promise<Uint8Array | null> {
  const w = get();
  if (!w) return null;
  const from = sentFaces.get(fonts) ?? 0;
  for (const f of fonts.faces.slice(from)) w.postMessage({ type: 'font', family: f.family, bytes: f.bytes, subset: f.subset, weight: f.weight, italic: f.italic });
  sentFaces.set(fonts, fonts.faces.length);
  for (const [id, bytes] of assets) {
    const mime = doc.assets[id.replace(/\.poster$/, '')]?.mime ?? '';
    if (sentImages.has(id) || !(mime.startsWith('image/') || id.endsWith('.poster'))) continue;
    sentImages.add(id);
    w.postMessage({ type: 'image', id, bytes });
  }
  const id = ++seq;
  return new Promise<Uint8Array>((resolve, reject) => {
    waits.set(id, { resolve, reject });
    w.postMessage({ type: 'render', id, doc, pageId, scale });
  });
}
