/**
 * Free stock content for agents: the same keyless, CORS-friendly sources the
 * editor's side panels use (Iconify graphics and icons, Openverse photos and
 * audio, Wikimedia Commons photos/video/audio, NASA), reused from the web app's
 * pure adapters.
 */
import { parseSvg, type PathElement } from '@digital-canvas/scene';
import { feedFor, sourcesFor, createFeed } from '../../../apps/web/src/lib/content/search.ts';
import { loadIcons, isSimpleSvg } from '../../../apps/web/src/lib/content/iconify.ts';
import { resolveNasa } from '../../../apps/web/src/lib/content/nasa.ts';
import { creditLine } from '../../../apps/web/src/lib/content/util.ts';
import type { Item, Kind, SourceId } from '../../../apps/web/src/lib/content/types.ts';

export type { Item, Kind, SourceId };
export { creditLine };

export const STOCK_KINDS: Kind[] = ['photo', 'video', 'audio', 'graphic', 'sticker', 'icon', 'illustration'];

/** A compact result for the agent (what import_stock needs, plus what helps it choose). */
export interface StockResult {
  kind: Kind;
  source: SourceId;
  title: string;
  /** Iconify name: use directly as `{ type: "icon", icon }` in add_elements. */
  icon?: string;
  url?: string;
  fallback?: string;
  manifest?: string;
  thumb?: string;
  width?: number;
  height?: number;
  duration?: number;
  credit: string;
}

export function compact(i: Item): StockResult {
  return {
    kind: i.kind, source: i.source, title: i.title.slice(0, 120),
    ...(i.icon ? { icon: i.icon } : {}), ...(i.url ? { url: i.url } : {}), ...(i.fallback && i.fallback !== i.url ? { fallback: i.fallback } : {}),
    ...(i.manifest ? { manifest: i.manifest } : {}),
    ...(i.thumb && !i.thumb.startsWith('data:') ? { thumb: i.thumb } : {}),
    ...(i.width ? { width: i.width, height: i.height } : {}), ...(i.duration ? { duration: Math.round(i.duration * 10) / 10 } : {}),
    credit: creditLine(i.credit),
  };
}

export async function searchStock(kind: Kind, query: string, opts: { source?: SourceId; limit?: number; audio?: 'music' | 'sound_effect' } = {}): Promise<{ items: StockResult[]; failed: SourceId[] }> {
  const limit = opts.limit ?? 12;
  const feed = opts.source ? createFeed(sourcesFor(kind, { only: opts.source, audio: opts.audio }), query.trim() || 'nature') : feedFor(kind, query, { audio: opts.audio });
  const items: Item[] = [];
  for (let i = 0; i < 3 && items.length < limit && !feed.done; i++) items.push(...(await feed.next()));
  return { items: items.slice(0, limit).map(compact), failed: [...feed.failed] };
}

/** The file to download for a stock result (NASA items list their files in a manifest). */
export async function stockUrl(r: { kind: Kind; url?: string; manifest?: string }): Promise<string> {
  if (r.url) return r.url;
  if (r.manifest) {
    const got = await resolveNasa({ kind: r.kind, manifest: r.manifest, source: 'nasa' } as Item);
    if (got.url) return got.url;
  }
  throw new Error('this result has no downloadable file; pass the `url` (or `manifest`) from search_stock');
}

/** Iconify icons as vector path elements, `color` replacing currentColor. */
export async function iconElements(names: string[]): Promise<Map<string, string>> {
  return loadIcons(names);
}

export function iconPath(svg: string, color: string, box: { x: number; y: number; w: number; h: number; rotation?: number; opacity?: number }, name: string): Omit<PathElement, 'id'> | null {
  const parsed = parseSvg(svg, color);
  if (!parsed) return null;
  const s = Math.min(box.w / parsed.viewBox.w, box.h / parsed.viewBox.h);
  const w = parsed.viewBox.w * s, h = parsed.viewBox.h * s;
  return {
    type: 'path', name, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h, rotation: box.rotation ?? 0, opacity: box.opacity ?? 1,
    viewBox: parsed.viewBox, paths: parsed.paths.map((p) => (p.stroke ? { ...p, stroke: { ...p.stroke, width: p.stroke.width * s } } : p)),
  };
}

export { isSimpleSvg };
