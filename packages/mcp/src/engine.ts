/**
 * CanvasKit (from the platform: Node or browser): loaded once per process, with
 * one font library that collects every face a design embeds. Each render gets
 * its own Renderer (decoded images are freed afterwards), so a long-lived
 * server stays small.
 */
import type { CanvasKit } from 'canvaskit-wasm';
import { FontLibrary, Renderer } from '@digital-canvas/render';
import { posterOf, walk, type Doc, type Page } from '@digital-canvas/scene';
import type { ProjectFile } from '@digital-canvas/storage';
import { platform } from './platform.ts';

export interface Engine {
  ck: CanvasKit;
  fonts: FontLibrary;
}

let loading: Promise<Engine> | null = null;

export function engine(): Promise<Engine> {
  loading ??= (async () => {
    const p = platform();
    const ck = await p.canvasKit();
    const fonts = new FontLibrary(ck);
    await p.loadBundledFonts(fonts);
    return { ck, fonts };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Asset ids a set of pages draws (images, video posters, frames). */
export function assetsOf(pages: readonly Page[]): Set<string> {
  const ids = new Set<string>();
  for (const p of pages) for (const e of walk(p.elements)) {
    if (e.type === 'image') { if (e.asset) ids.add(e.asset); }
    else if (e.type === 'video') { ids.add(posterOf(e)); }
  }
  return ids;
}

/** Register the fonts a design embeds (once per process). */
export function loadDocFonts(eng: Engine, file: ProjectFile): void {
  for (const f of file.doc.fonts ?? []) {
    const b = file.assets.get(f.asset);
    if (b) eng.fonts.addOnce(f.family, f.asset, b, f.subset, { weight: f.weight, italic: f.italic });
  }
}

/**
 * Run `fn` with a renderer that has the design's fonts and the pictures of
 * `pages` (all pages when omitted) decoded. Disposed afterwards.
 */
export async function withRenderer<T>(file: ProjectFile, fn: (r: Renderer, eng: Engine) => T | Promise<T>, pages?: readonly Page[]): Promise<T> {
  const eng = await engine();
  loadDocFonts(eng, file);
  const r = new Renderer(eng.ck, eng.fonts);
  try {
    for (const id of assetsOf(pages ?? file.doc.pages)) {
      const bytes = file.assets.get(id);
      if (bytes && file.doc.assets[id]?.mime.startsWith('image/')) r.setImage(id, bytes);
    }
    return await fn(r, eng);
  } finally {
    r.dispose();
  }
}

/** A PNG preview of page 1 (≤ 480 px), as stores keep with each design. */
export async function thumbnail(file: ProjectFile): Promise<Uint8Array> {
  const doc: Doc = file.doc;
  const page = doc.pages.find((p) => !p.hidden) ?? doc.pages[0]!;
  return withRenderer(file, (r) => r.exportPage(doc, page, { scale: Math.min(1, 480 / Math.max(doc.width, doc.height)) }), [page]);
}
