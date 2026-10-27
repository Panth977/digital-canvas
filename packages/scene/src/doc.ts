import { FORMAT, VERSION } from './types.ts';
import type { AudioClip, ChartElement, Doc, Element, Fill, GroupElement, Page, PathElement, ShapeElement, ShapeKind, TableElement, TextElement, TextStyle, ImageElement, LineElement, Unit, VideoElement } from './types.ts';
import { toPx, MIN_SIDE, MAX_SIDE } from './units.ts';
import { childrenOf, mapLists, offsetElement, transformChildren, walk, withChildren } from './tree.ts';

/**
 * Pure document operations. Every function returns a new Doc and never
 * mutates its input, so the editor can keep old versions for undo and the
 * same calls work for scripts and AI agents.
 */

export function newId(prefix = ''): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += (b % 36).toString(36);
  return prefix + s;
}

export const WHITE: Fill = { type: 'solid', color: '#ffffff' };

export function newPage(background: Fill = WHITE): Page {
  return { id: newId('p_'), background, elements: [] };
}

export interface NewDocOptions {
  title?: string;
  width: number;
  height: number;
  unit?: Unit;
  print?: boolean;
}

/** `width`/`height` are in `unit`; they are stored in px. */
export function createDoc(opts: NewDocOptions): Doc {
  const unit = opts.unit ?? 'px';
  const clamp = (v: number) => Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(v * 100) / 100));
  const now = new Date().toISOString();
  return {
    format: FORMAT,
    version: VERSION,
    id: newId('d_'),
    title: opts.title ?? 'Untitled design',
    unit,
    width: clamp(toPx(opts.width, unit)),
    height: clamp(toPx(opts.height, unit)),
    bleed: opts.print ? toPx(3, 'mm') : 0,
    pages: [newPage()],
    assets: {},
    createdAt: now,
    updatedAt: now,
  };
}

function touch(doc: Doc, patch: Partial<Doc>): Doc {
  return { ...doc, ...patch, updatedAt: new Date().toISOString() };
}

function mapPage(doc: Doc, pageId: string, fn: (p: Page) => Page): Doc {
  return touch(doc, { pages: doc.pages.map((p) => (p.id === pageId ? fn(p) : p)) });
}

// ---- lookups ----

/** Finds elements inside groups too: `parent` is the containing group (null at top level), `index` the place in its list. */
export function findElement(doc: Doc, id: string): { page: Page; element: Element; index: number; parent: Element | null } | null {
  const search = (els: Element[], parent: Element | null): { element: Element; index: number; parent: Element | null } | null => {
    for (let index = 0; index < els.length; index++) {
      const e = els[index]!;
      if (e.id === id) return { element: e, index, parent };
      const c = childrenOf(e);
      const hit = c && search(c, e);
      if (hit) return hit;
    }
    return null;
  };
  for (const page of doc.pages) {
    const hit = search(page.elements, null);
    if (hit) return { page, ...hit };
  }
  return null;
}

export function pageOf(doc: Doc, elementId: string): Page | null {
  return findElement(doc, elementId)?.page ?? null;
}

// ---- element factories ----

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 32,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: '#1f2328',
  align: 'left',
  lineHeight: 1.25,
  letterSpacing: 0,
  uppercase: false,
};

export function shape(kind: ShapeKind, box: { x: number; y: number; w: number; h: number }, fill: Fill = { type: 'solid', color: '#8b5cf6' }): ShapeElement {
  return { id: newId('e_'), type: 'shape', shape: kind, ...box, rotation: 0, opacity: 1, fill, stroke: null, radius: 0 };
}

export function text(value: string, box: { x: number; y: number; w: number; h: number }, style: Partial<TextStyle> = {}): TextElement {
  return { id: newId('e_'), type: 'text', text: value, ...box, rotation: 0, opacity: 1, style: { ...DEFAULT_TEXT_STYLE, ...style } };
}

export function image(asset: string, box: { x: number; y: number; w: number; h: number }): ImageElement {
  return { id: newId('e_'), type: 'image', asset, ...box, rotation: 0, opacity: 1, radius: 0 };
}

export function pathElement(paths: PathElement['paths'], viewBox: PathElement['viewBox'], box: { x: number; y: number; w: number; h: number }): PathElement {
  return { id: newId('e_'), type: 'path', ...box, rotation: 0, opacity: 1, viewBox, paths };
}

export function video(asset: string, box: { x: number; y: number; w: number; h: number }): VideoElement {
  return { id: newId('e_'), type: 'video', asset, ...box, rotation: 0, opacity: 1, radius: 0 };
}

// ---- element ops ----

export function addElements(doc: Doc, pageId: string, elements: Element[]): Doc {
  return mapPage(doc, pageId, (p) => ({ ...p, elements: [...p.elements, ...elements] }));
}

export type ElementPatch = Partial<Omit<ShapeElement, 'id' | 'type'>> | Partial<Omit<TextElement, 'id' | 'type'>> | Partial<Omit<ImageElement, 'id' | 'type'>> | Partial<Omit<VideoElement, 'id' | 'type'>> | Partial<Omit<PathElement, 'id' | 'type'>>
  | Partial<Omit<LineElement, 'id' | 'type'>> | Partial<Omit<TableElement, 'id' | 'type'>> | Partial<Omit<ChartElement, 'id' | 'type'>> | Partial<Omit<GroupElement, 'id' | 'type'>>;

const FRAME_KEYS = ['x', 'y', 'w', 'h', 'rotation', 'flipX', 'flipY'] as const;

/** Apply a patch; a container whose box changed carries its children along. */
function patchElement(e: Element, patch: ElementPatch): Element {
  const n = { ...e, ...patch } as Element;
  const kids = childrenOf(e);
  if (kids && !('children' in patch) && FRAME_KEYS.some((k) => k in patch && (patch as Record<string, unknown>)[k] !== e[k])) {
    return withChildren(n, transformChildren(e, n, kids));
  }
  return n;
}

/** Patch several elements (also inside groups); `patch` may be a function of the old element. */
export function updateElements(doc: Doc, ids: string[], patch: ElementPatch | ((e: Element) => ElementPatch)): Doc {
  const set = new Set(ids);
  let changed = false;
  const pages = doc.pages.map((p) => {
    const elements = mapLists(p.elements, (list) => {
      if (!list.some((e) => set.has(e.id))) return list;
      return list.map((e) => (set.has(e.id) ? patchElement(e, typeof patch === 'function' ? patch(e) : patch) : e));
    });
    if (elements === p.elements) return p;
    changed = true;
    return { ...p, elements };
  });
  return changed ? touch(doc, { pages }) : doc;
}

/** Remove elements (also from groups; a group left empty goes too). */
export function removeElements(doc: Doc, ids: string[]): Doc {
  const set = new Set(ids);
  return touch(doc, { pages: doc.pages.map((p) => ({ ...p, elements: mapLists(p.elements, (list) => (list.some((e) => set.has(e.id)) ? list.filter((e) => !set.has(e.id)) : list)) })) });
}

/** A deep copy with fresh ids (children too), moved by (`dx`, `dy`). */
export function cloneElement<T extends Element>(e: T, dx = 0, dy = 0): T {
  const reId = (x: Element): Element => {
    const c = { ...x, id: newId('e_') };
    const kids = childrenOf(x);
    return kids ? withChildren(c, kids.map(reId)) : c;
  };
  return offsetElement(reId(structuredClone(e)), dx, dy) as T;
}

/** Copies of `ids` in their own list (page or group), offset by `offset` px. Returns the doc and the new ids. */
export function duplicateElements(doc: Doc, ids: string[], offset = 20): { doc: Doc; ids: string[] } {
  const newIds: string[] = [];
  const set = new Set(ids);
  const pages = doc.pages.map((p) => {
    const elements = mapLists(p.elements, (list) => {
      const copies = list.filter((e) => set.has(e.id)).map((e) => cloneElement(e, offset, offset));
      newIds.push(...copies.map((c) => c.id));
      return copies.length ? [...list, ...copies] : list;
    });
    return elements === p.elements ? p : { ...p, elements };
  });
  return { doc: touch(doc, { pages }), ids: newIds };
}

export type Arrange = 'forward' | 'backward' | 'front' | 'back';

/** Change stacking order within each element's list (its page, or its group). */
export function arrange(doc: Doc, ids: string[], how: Arrange): Doc {
  const set = new Set(ids);
  const pages = doc.pages.map((p) => ({ ...p, elements: mapLists(p.elements, (list) => {
    if (!list.some((e) => set.has(e.id))) return list;
    let els = [...list];
    if (how === 'front') els = [...els.filter((e) => !set.has(e.id)), ...els.filter((e) => set.has(e.id))];
    else if (how === 'back') els = [...els.filter((e) => set.has(e.id)), ...els.filter((e) => !set.has(e.id))];
    else if (how === 'forward') {
      for (let i = els.length - 2; i >= 0; i--) if (set.has(els[i]!.id) && !set.has(els[i + 1]!.id)) [els[i], els[i + 1]] = [els[i + 1]!, els[i]!];
    } else {
      for (let i = 1; i < els.length; i++) if (set.has(els[i]!.id) && !set.has(els[i - 1]!.id)) [els[i], els[i - 1]] = [els[i - 1]!, els[i]!];
    }
    return els;
  }) }));
  return touch(doc, { pages });
}

/** Move one element to `index` in its list's stack (layers panel drag). */
export function moveElementTo(doc: Doc, id: string, index: number): Doc {
  const hit = findElement(doc, id);
  if (!hit) return doc;
  return mapPage(doc, hit.page.id, (p) => ({ ...p, elements: mapLists(p.elements, (list) => {
    if (!list.includes(hit.element)) return list;
    const els = list.filter((e) => e.id !== id);
    els.splice(Math.max(0, Math.min(index, els.length)), 0, hit.element);
    return els;
  }) }));
}

// ---- page ops ----

export function addPage(doc: Doc, afterId?: string): { doc: Doc; pageId: string } {
  const page = newPage();
  const i = afterId ? doc.pages.findIndex((p) => p.id === afterId) : doc.pages.length - 1;
  const pages = [...doc.pages];
  pages.splice(i + 1, 0, page);
  return { doc: touch(doc, { pages }), pageId: page.id };
}

export function duplicatePage(doc: Doc, pageId: string): { doc: Doc; pageId: string } {
  const i = doc.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return { doc, pageId };
  const src = doc.pages[i]!;
  const copy: Page = { ...structuredClone(src), id: newId('p_'), elements: src.elements.map((e) => cloneElement(e)) };
  const pages = [...doc.pages];
  pages.splice(i + 1, 0, copy);
  return { doc: touch(doc, { pages }), pageId: copy.id };
}

/** Never removes the last page. */
export function removePage(doc: Doc, pageId: string): Doc {
  if (doc.pages.length <= 1) return doc;
  return touch(doc, { pages: doc.pages.filter((p) => p.id !== pageId) });
}

export function movePage(doc: Doc, pageId: string, toIndex: number): Doc {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  const pages = doc.pages.filter((p) => p.id !== pageId);
  pages.splice(Math.max(0, Math.min(toIndex, pages.length)), 0, page);
  return touch(doc, { pages });
}

export function updatePage(doc: Doc, pageId: string, patch: Partial<Omit<Page, 'id' | 'elements'>>): Doc {
  return mapPage(doc, pageId, (p) => ({ ...p, ...patch }));
}

export function setTitle(doc: Doc, title: string): Doc {
  return touch(doc, { title });
}

/** Assets no image element or embedded font uses are dropped (an empty frame uses none). */
export function pruneAssets(doc: Doc): Doc {
  const used = new Set<string>();
  for (const p of doc.pages) for (const e of walk(p.elements)) if ((e.type === 'image' || e.type === 'video') && e.asset) used.add(e.asset);
  for (const a of doc.audio ?? []) used.add(a.asset);
  for (const k of [...used]) used.add(`${k}.poster`); // a video's poster frame
  for (const f of doc.fonts ?? []) used.add(f.asset);
  const assets = Object.fromEntries(Object.entries(doc.assets).filter(([k]) => used.has(k)));
  return Object.keys(assets).length === Object.keys(doc.assets).length ? doc : { ...doc, assets };
}

/**
 * Drop embedded fonts the user added (catalogue or upload) whose family no
 * text uses any more. Fonts without a `source` (e.g. from an import, where a
 * face may serve as a fallback) are kept.
 */
export function pruneFonts(doc: Doc): Doc {
  if (!doc.fonts?.length) return doc;
  const used = new Set<string>();
  for (const p of doc.pages) for (const e of walk(p.elements)) {
    if (e.type === 'table') for (const row of e.cells) for (const c of row) used.add(c.style?.fontFamily ?? e.style.fontFamily);
    if (e.type === 'chart') used.add(e.style.fontFamily);
    if (e.type !== 'text') continue;
    used.add(e.style.fontFamily);
    for (const r of e.runs ?? []) if (r.style?.fontFamily) used.add(r.style.fontFamily);
  }
  const fonts = doc.fonts.filter((f) => !f.source || used.has(f.family));
  return fonts.length === doc.fonts.length ? doc : { ...doc, fonts };
}

// ---- timeline (video and presentations) ----

export const DEFAULT_PAGE_DURATION = 5;

export const pageDuration = (p: Page): number => (p.duration && p.duration > 0 ? p.duration : DEFAULT_PAGE_DURATION);

/** A design is a video when a page has a duration, holds a video clip, or the design has sound. */
export function isVideo(doc: Doc): boolean {
  return !!doc.audio?.length || doc.pages.some((p) => p.duration !== undefined || [...walk(p.elements)].some((e) => e.type === 'video'));
}

/** Total length of the visible pages, seconds. */
export function totalDuration(doc: Doc): number {
  return doc.pages.filter((p) => !p.hidden).reduce((t, p) => t + pageDuration(p), 0);
}

/** Where page `pageId` starts on the timeline, seconds. */
export function pageStart(doc: Doc, pageId: string): number {
  let t = 0;
  for (const p of doc.pages) {
    if (p.hidden) continue;
    if (p.id === pageId) return t;
    t += pageDuration(p);
  }
  return t;
}

/** The page showing at time `t` and the time within it. */
export function pageAtTime(doc: Doc, t: number): { page: Page; local: number; start: number } {
  const pages = doc.pages.filter((p) => !p.hidden);
  let start = 0;
  for (const p of pages) {
    const d = pageDuration(p);
    if (t < start + d) return { page: p, local: Math.max(0, t - start), start };
    start += d;
  }
  const last = pages[pages.length - 1] ?? doc.pages[0]!;
  return { page: last, local: pageDuration(last), start: start - pageDuration(last) };
}

/** Time in the video file for a clip `local` seconds into its page (null when the clip has ended). */
export function clipTime(el: VideoElement, local: number, fileDuration: number): number | null {
  const a = el.trimStart ?? 0;
  const b = Math.min(el.trimEnd ?? fileDuration, fileDuration);
  const len = Math.max(0.001, b - a);
  if (local < len) return a + local;
  return el.loop ? a + (local % len) : null;
}

export function addAudio(doc: Doc, clip: Omit<AudioClip, 'id'>): { doc: Doc; id: string } {
  const id = newId('a_');
  return { doc: touch(doc, { audio: [...(doc.audio ?? []), { ...clip, id }] }), id };
}

export function updateAudio(doc: Doc, id: string, patch: Partial<Omit<AudioClip, 'id'>>): Doc {
  return touch(doc, { audio: (doc.audio ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)) });
}

export function removeAudio(doc: Doc, id: string): Doc {
  return touch(doc, { audio: (doc.audio ?? []).filter((a) => a.id !== id) });
}
