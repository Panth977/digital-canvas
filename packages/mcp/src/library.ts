/**
 * Built-in content for agents: size presets, the template library, and
 * applying a brand kit to a design.
 */
import {
  PRESETS, cloneElement, newId, parseDoc, resizeDoc, searchPresets, walk, type Doc, type Element, type Page, type Preset, type TextElement,
} from '@digital-canvas/scene';
import { brandColors, type BrandData } from '@digital-canvas/storage';
import { recolorDoc, colorsOfElement } from '../../../apps/web/src/lib/recolor.ts';
import { platform, type TemplateEntry } from './platform.ts';
import { assetId } from '@digital-canvas/storage';
import type { ProjectFile } from '@digital-canvas/storage';

// ---------------------------------------------------------------- presets

const ALIAS: Record<string, string> = {
  poster: 'poster-a3', reel: 'instagram-reel', 'ig-reel': 'instagram-reel', 'ig-post': 'instagram-post', 'ig-story': 'instagram-story', square: 'instagram-post',
  shorts: 'youtube-shorts', tiktok: 'tiktok-video', thumbnail: 'youtube-thumbnail', 'yt-thumbnail': 'youtube-thumbnail', slide: 'presentation', deck: 'presentation',
  flyer: 'flyer-a4', 'a4-portrait': 'a4', 'business card': 'business-card', 'facebook-cover-photo': 'facebook-cover', linkedin: 'linkedin-post', twitter: 'x-post', 'twitter-post': 'x-post',
};

export function findPreset(name: string): Preset | null {
  const id = name.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const direct = PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === ALIAS[id] || p.id === ALIAS[name.trim().toLowerCase()]);
  if (direct) return direct;
  return searchPresets(name.replace(/[-_]/g, ' '))[0] ?? null;
}

export const POPULAR_PRESETS = ['instagram-post', 'instagram-portrait', 'instagram-story', 'instagram-reel', 'facebook-post', 'linkedin-post', 'x-post', 'pinterest-pin', 'youtube-thumbnail', 'youtube-shorts', 'tiktok-video', 'presentation', 'a4', 'letter', 'flyer-a4', 'poster-a3', 'poster-18x24', 'business-card', 'invitation', 'logo'];

// ---------------------------------------------------------------- templates

export type { TemplateEntry };

export function templates(): TemplateEntry[] {
  return platform().templateIndex();
}

export function searchTemplates(query = '', category?: string, size?: { width: number; height: number }): TemplateEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  let list = templates().filter((t) => (!category || t.category.toLowerCase() === category.toLowerCase()) && words.every((w) => `${t.id} ${t.title} ${t.category} ${t.tags}`.toLowerCase().includes(w)));
  if (size) {
    const r = size.width / size.height;
    const d = (t: TemplateEntry) => Math.abs(Math.log(t.width / t.height / r));
    list = [...list].sort((a, b) => Number(d(a) > 0.05) - Number(d(b) > 0.05));
  }
  return list;
}

export async function loadTemplate(id: string): Promise<Doc> {
  if (!/^[\w-]+$/.test(id) || !templates().some((t) => t.id === id)) throw new Error(`no template "${id}"`);
  return parseDoc(structuredClone(await platform().templateDoc(id)));
}

export const templateThumb = (id: string, base: string) => `${base}/templates/${id}.png`;

/** Scale `src` to a page size (like Resize), with fresh ids. Returns the pages and old → new element ids. */
export function fitPages(src: Doc, width: number, height: number): { pages: Page[]; ids: Map<string, string> } {
  const fit = Math.min(width / src.width, height / src.height);
  const same = Math.abs(src.width - width) < 0.5 && Math.abs(src.height - height) < 0.5;
  const sized = same ? src : resizeDoc(src, { width, height });
  const ids = new Map<string, string>();
  const fix = (e: Element): Element => {
    if (same) return e;
    if (e.type === 'line') return { ...e, start: { ...e.start, x: e.start.x * fit, y: e.start.y * fit }, end: { ...e.end, x: e.end.x * fit, y: e.end.y * fit }, stroke: { ...e.stroke, width: e.stroke.width * fit } };
    if (e.type === 'table') return { ...e, style: { ...e.style, fontSize: e.style.fontSize * fit }, padding: e.padding * fit, border: e.border && { ...e.border, width: e.border.width * fit } };
    if (e.type === 'chart') return { ...e, style: { ...e.style, fontSize: e.style.fontSize * fit } };
    if (e.type === 'group') return { ...e, children: e.children.map(fix) };
    return e;
  };
  const clone = (e: Element): Element => {
    const c = cloneElement(fix(e));
    // cloneElement gives fresh ids depth-first; record the mapping the same way
    const a = [...walk([e])], b = [...walk([c])];
    a.forEach((x, i) => ids.set(x.id, b[i]!.id));
    return c;
  };
  return { pages: sized.pages.map((p) => ({ ...p, id: newId('p_'), elements: p.elements.map(clone) })), ids };
}

/** Bring a template's (or other design's) embedded assets and fonts along. */
export function mergeAssets(file: ProjectFile, src: Doc, srcAssets: Map<string, Uint8Array> = new Map()): void {
  const assets = { ...file.doc.assets };
  for (const [id, meta] of Object.entries(src.assets)) {
    const b = srcAssets.get(id);
    if (!b) continue;
    file.assets.set(id, b);
    assets[id] = meta;
  }
  const fonts = [...(file.doc.fonts ?? [])];
  for (const f of src.fonts ?? []) if (srcAssets.has(f.asset) && !fonts.some((x) => x.asset === f.asset)) fonts.push(f);
  file.doc = { ...file.doc, assets, ...(fonts.length ? { fonts } : {}) };
}

export interface TextReplace { match: string; text: string }

/**
 * Replace template texts: `match` is a template element id (from the template
 * outline), the element's name, or (part of) its current text.
 */
export function replaceTexts(pages: Page[], ids: Map<string, string>, replace: TextReplace[], warnings: string[]): Page[] {
  const want = replace.map((r) => ({ ...r, id: ids.get(r.match) ?? r.match, done: false }));
  const fix = (e: Element): Element => {
    if (e.type === 'group') return { ...e, children: e.children.map(fix) };
    if (e.type !== 'text') return e;
    const r = want.find((w) => !w.done && (w.id === e.id || (e.name && w.match === e.name))) ?? want.find((w) => !w.done && e.text.toLowerCase().includes(w.match.toLowerCase()));
    if (!r) return e;
    r.done = true;
    const { runs: _runs, ...rest } = e;
    return { ...rest, text: r.text } as TextElement;
  };
  const out = pages.map((p) => ({ ...p, elements: p.elements.map(fix) }));
  for (const w of want) if (!w.done) warnings.push(`replace_text: nothing matched "${w.match}"`);
  return out;
}

// ---------------------------------------------------------------- brand kit

const sat = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r!, g!, b!), mn = Math.min(r!, g!, b!);
  return mx === 0 ? 0 : (mx - mn) / mx;
};
const isNeutral = (hex: string) => sat(hex) < 0.12;

/**
 * Apply a brand kit: brand colours replace the design's accent colours (most
 * used first; whites, blacks and greys stay), brand fonts replace text fonts
 * by role (largest text = heading), and the first logo can be placed.
 */
export async function applyBrand(file: ProjectFile, brand: BrandData, opts: { colors?: boolean; fonts?: boolean; logo?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'none'; pages?: string[] }): Promise<{ recolored: Record<string, string>; fonts: Record<string, string>; logo?: string }> {
  const kit = brand.kit;
  let doc = file.doc;
  const inScope = (p: Page) => !opts.pages || opts.pages.includes(p.id);
  const recolored: Record<string, string> = {};
  if (opts.colors !== false) {
    const palette = brandColors(kit).filter((c) => !isNeutral(c));
    const use = new Map<string, number>();
    for (const p of doc.pages.filter(inScope)) {
      const bg = p.background.type === 'solid' ? [p.background.color] : p.background.stops.map((s) => s.color);
      for (const c of bg) use.set(c.slice(0, 7).toLowerCase(), (use.get(c.slice(0, 7).toLowerCase()) ?? 0) + doc.width * doc.height);
      for (const e of walk(p.elements)) for (const c of colorsOfElement(e)) use.set(c, (use.get(c) ?? 0) + e.w * e.h);
    }
    const accents = [...use.entries()].filter(([c]) => !isNeutral(c)).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    accents.forEach((c, i) => { if (palette.length) recolored[c] = palette[i % palette.length]!; });
    const scoped = { ...doc, pages: doc.pages.filter(inScope) };
    let changed = scoped;
    for (const [from, to] of Object.entries(recolored)) changed = recolorDoc(changed, from, to);
    doc = { ...doc, pages: doc.pages.map((p) => changed.pages.find((x) => x.id === p.id) ?? p) };
  }
  const fonts: Record<string, string> = {};
  if (opts.fonts !== false && (kit.fonts.heading || kit.fonts.body || kit.fonts.subheading)) {
    const sizes = doc.pages.filter(inScope).flatMap((p) => [...walk(p.elements)]).filter((e): e is TextElement => e.type === 'text').map((t) => t.style.fontSize);
    const max = Math.max(1, ...sizes);
    const roleOf = (fs: number) => (fs >= max * 0.6 ? 'heading' : fs >= max * 0.32 ? 'subheading' : 'body') as 'heading' | 'subheading' | 'body';
    const fix = (e: Element): Element => {
      if (e.type === 'group') return { ...e, children: e.children.map(fix) };
      if (e.type !== 'text') return e;
      const role = roleOf(e.style.fontSize);
      const f = kit.fonts[role] ?? kit.fonts.body ?? kit.fonts.heading;
      if (!f) return e;
      fonts[e.id] = `${role}: ${f.fontFamily}`;
      return { ...e, style: { ...e.style, fontFamily: f.fontFamily, bold: f.bold, italic: f.italic, uppercase: f.uppercase || e.style.uppercase, ...(f.color && role !== 'body' ? {} : {}) }, ...(e.runs ? { runs: e.runs.map((r) => (r.style?.fontFamily ? { ...r, style: { ...r.style, fontFamily: f.fontFamily } } : r)) } : {}) };
    };
    doc = { ...doc, pages: doc.pages.map((p) => (inScope(p) ? { ...p, elements: p.elements.map(fix) } : p)) };
  }
  let logo: string | undefined;
  const l = kit.logos[0];
  if (opts.logo && opts.logo !== 'none' && l) {
    const bytes = brand.assets.get(l.asset);
    if (bytes) {
      const id = /^[0-9a-f]{20}\./.test(l.asset) ? l.asset : await assetId(bytes, l.mime);
      file.assets.set(id, bytes);
      doc = { ...doc, assets: { ...doc.assets, [id]: { mime: l.mime, ...(l.width ? { width: l.width, height: l.height } : {}), name: l.name } } };
      const short = Math.min(doc.width, doc.height), m = short * 0.05;
      const iw = l.width ?? 1, ih = l.height ?? 1;
      const s = Math.min((short * 0.16) / iw, (short * 0.1) / ih);
      const w = iw * s, h = ih * s;
      const x = opts.logo.endsWith('left') ? m : doc.width - m - w, y = opts.logo.startsWith('top') ? m : doc.height - m - h;
      doc = { ...doc, pages: doc.pages.map((p) => {
        if (!inScope(p)) return p;
        const el = { id: newId('e_'), type: 'image' as const, asset: id, x, y, w, h, rotation: 0, opacity: 1, radius: 0, name: 'Logo' };
        logo ??= el.id;
        return { ...p, elements: [...p.elements, el] };
      }) };
    }
  }
  file.doc = doc;
  return { recolored, fonts, ...(logo ? { logo } : {}) };
}
