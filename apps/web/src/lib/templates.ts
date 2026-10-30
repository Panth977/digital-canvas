/**
 * Templates: the built-in library (apps/web/src/templates, real designs from
 * open catalogues, built by tools/templates/penpot-import/build.ts) and putting
 * any design's pages into the open one
 * (a template, or one of your own designs).
 */
import { cloneElement, newId, parseDoc, resizeDoc, walk, type Doc, type Element, type Page } from '@digital-canvas/scene';
import type { EditorState } from './editor.svelte.ts';
import { catalog, fetchFamily, type FontFile } from './fonts.ts';
import INDEX from '../templates/index.json';

export interface TemplateEntry {
  id: string;
  title: string;
  category: string;
  tags: string;
  width: number;
  height: number;
  pages: number;
  fonts: string[];
  video?: boolean;
  /** Pictures the template needs, in public/templates/assets. */
  assets?: string[];
  /** Who made it and under which licence. */
  credit: TemplateCredit;
}

export interface TemplateCredit {
  author: string;
  authorUrl?: string;
  catalog: string;
  sourceUrl: string;
  fileUrl?: string;
  licence: string;
  licenceUrl: string;
}

/** e.g. "CC BY 4.0" from "CC-BY-4.0". */
export const licenceName = (spdx: string) => spdx.replace(/^CC-BY-SA-/, 'CC BY-SA ').replace(/^CC-BY-/, 'CC BY ').replace(/^CC0-1\.0$/, 'CC0');
export const creditLine = (t: TemplateEntry) => `${t.title} by ${t.credit.author}, ${t.credit.catalog} (${licenceName(t.credit.licence)})`;

export const TEMPLATES = INDEX as TemplateEntry[];
export const TEMPLATE_CATEGORIES = [...new Set(TEMPLATES.map((t) => t.category))];

const files = import.meta.glob<Doc>('../templates/*.json', { import: 'default' });

export const thumbUrl = (id: string) => `${import.meta.env.BASE_URL}templates/${id}.png`;

export async function loadTemplate(id: string): Promise<Doc> {
  const load = files[`../templates/${id}.json`];
  if (!load) throw new Error(`no template ${id}`);
  return parseDoc(structuredClone(await load()));
}

/** The picture files a template uses (fetched from the app's own /templates/assets/). */
export async function loadTemplateAssets(doc: Doc): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  await Promise.all(Object.entries(doc.assets).filter(([, m]) => m.mime.startsWith('image/')).map(async ([id]) => {
    const r = await fetch(`${import.meta.env.BASE_URL}templates/assets/${id}`);
    if (!r.ok) throw new Error(`picture ${id}: HTTP ${r.status}`);
    out.set(id, new Uint8Array(await r.arrayBuffer()));
  }));
  return out;
}

/** Templates matching words (title, category, tags) and a category ('All' = any). */
export function searchTemplates(query: string, category = 'All', list = TEMPLATES): TemplateEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((t) => (category === 'All' || t.category === category) && words.every((w) => `${t.title} ${t.category} ${t.tags} ${t.credit.author}`.toLowerCase().includes(w)));
}

/** Templates shaped like the open design come first (same aspect ratio). */
export function byFit(list: TemplateEntry[], width: number, height: number): TemplateEntry[] {
  const r = width / height;
  const d = (t: TemplateEntry) => Math.abs(Math.log(t.width / t.height / r));
  return [...list].sort((a, b) => Number(d(a) > 0.05) - Number(d(b) > 0.05));
}

/** Scale `src` to the open design's page size (like Resize), with fresh ids. */
export function fitPages(src: Doc, width: number, height: number): Page[] {
  const fit = Math.min(width / src.width, height / src.height);
  const sized = Math.abs(src.width - width) < 0.5 && Math.abs(src.height - height) < 0.5 ? src : resizeDoc(src, { width, height });
  const fix = (e: Element): Element => {
    if (sized === src) return e;
    // resizeDoc scales boxes; ends of lines and the text inside tables and charts need it too
    if (e.type === 'line') return { ...e, start: { ...e.start, x: e.start.x * fit, y: e.start.y * fit }, end: { ...e.end, x: e.end.x * fit, y: e.end.y * fit }, stroke: { ...e.stroke, width: e.stroke.width * fit } };
    if (e.type === 'table') return { ...e, style: { ...e.style, fontSize: e.style.fontSize * fit }, padding: e.padding * fit, border: e.border && { ...e.border, width: e.border.width * fit } };
    if (e.type === 'chart') return { ...e, style: { ...e.style, fontSize: e.style.fontSize * fit } };
    if (e.type === 'group') return { ...e, children: e.children.map(fix) };
    return e;
  };
  return sized.pages.map((p) => ({ ...p, id: newId('p_'), elements: p.elements.map((e) => cloneElement(fix(e))) }));
}

/** Families the pages use that this editor can't draw yet. */
export function missingFamilies(ed: EditorState, pages: Page[]): string[] {
  const need = new Set<string>();
  for (const p of pages) for (const e of walk(p.elements)) {
    if (e.type === 'text') { need.add(e.style.fontFamily); for (const r of e.runs ?? []) if (r.style?.fontFamily) need.add(r.style.fontFamily); }
    if (e.type === 'table' || e.type === 'chart') need.add(e.style.fontFamily);
  }
  return [...need].filter((f) => !ed.engine.fonts.families.has(f));
}

/** Download Google Fonts (via Fontsource) for the families; families it can't find are skipped. */
export async function fetchFonts(families: string[], sample = ''): Promise<FontFile[]> {
  if (!families.length) return [];
  const cat = await catalog().catch(() => []);
  const out: FontFile[] = [];
  await Promise.all(families.map(async (fam) => {
    const f = cat.find((c) => c.family.toLowerCase() === fam.toLowerCase());
    if (!f) return;
    try { out.push(...(await fetchFamily(f, sample))); } catch { /* offline: falls back to Inter */ }
  }));
  return out;
}

export type InsertMode = 'replace' | 'add';

/**
 * Put `src`'s pages into the open design: 'replace' swaps the current page for
 * the first one (more pages follow it), 'add' inserts them all after it.
 * `assets` are the bytes of the images, videos and fonts `src` uses.
 */
export async function insertDesign(ed: EditorState, src: Doc, mode: InsertMode, assets: Map<string, Uint8Array> = new Map()): Promise<void> {
  const key = `insert:${Date.now()}`;
  const pages = fitPages(src, ed.doc.width, ed.doc.height);
  // the source's own media and embedded fonts come along
  const docAssets = { ...ed.doc.assets };
  for (const [id, meta] of Object.entries(src.assets)) {
    const bytes = assets.get(id);
    if (!bytes) continue;
    ed.assets.set(id, bytes);
    if (meta.mime.startsWith('image/')) ed.renderer.setImage(id, bytes);
    docAssets[id] = meta;
  }
  const embedded: FontFile[] = (src.fonts ?? []).flatMap((f) => {
    const bytes = assets.get(f.asset);
    return bytes && !ed.engine.fonts.families.has(f.family) ? [{ family: f.family, bytes, mime: src.assets[f.asset]?.mime ?? 'font/ttf', weight: f.weight ?? 400, italic: !!f.italic, subset: f.subset, source: f.source ?? 'design' }] : [];
  });
  const sample = pages.flatMap((p) => [...walk(p.elements)]).map((e) => (e.type === 'text' ? e.text : '')).join(' ');
  const downloaded = await fetchFonts(missingFamilies(ed, pages).filter((f) => !embedded.some((x) => x.family === f)), sample);
  if (embedded.length || downloaded.length) await ed.addFonts([...embedded, ...downloaded], key);

  const doc = ed.doc;
  const at = doc.pages.findIndex((p) => p.id === ed.pageId);
  const list = [...doc.pages];
  if (mode === 'replace') {
    const cur = list[at]!;
    list.splice(at, 1, { ...pages[0]!, id: cur.id, ...(cur.duration ? { duration: cur.duration } : {}), ...(cur.notes ? { notes: cur.notes } : {}) }, ...pages.slice(1));
  } else list.splice(at + 1, 0, ...pages);
  const next: Doc = { ...ed.doc, assets: docAssets, pages: list, updatedAt: new Date().toISOString() };
  ed.commit(next, key);
  ed.seal();
  ed.select([], mode === 'replace' ? list[at]!.id : pages[0]!.id);
  ed.refitText();
  ed.seal();
}

/** Is the current page blank (nothing on it)? Then a template just fills it. */
export const pageIsEmpty = (ed: EditorState) => ed.page.elements.length === 0;
