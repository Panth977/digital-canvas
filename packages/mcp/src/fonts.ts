/**
 * Google Fonts for agents, via Fontsource (TTF files CanvasKit reads). A
 * design that uses a family gets its faces embedded (like the web app), so it
 * looks the same everywhere.
 */
import { walk, type Doc, type EmbeddedFont, type Page } from '@digital-canvas/scene';
import { assetId, type ProjectFile } from '@digital-canvas/storage';
import { platform } from './platform.ts';

const API = 'https://api.fontsource.org/v1/fonts';

export interface CatalogFont {
  id: string;
  family: string;
  category: string;
  weights: number[];
  styles: string[];
  subsets: string[];
}

let catalogLoad: Promise<CatalogFont[]> | null = null;
let catalogAt = 0;

/** Every family Fontsource has (≈2,000, mostly Google Fonts), cached for a day. */
export function catalog(): Promise<CatalogFont[]> {
  if (catalogLoad && Date.now() - catalogAt < 86400e3) return catalogLoad;
  catalogAt = Date.now();
  catalogLoad = (async () => {
    if (platform().offline) throw new Error('offline (DC_OFFLINE)');
    const r = await fetch(API, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`font list: HTTP ${r.status}`);
    const raw = (await r.json()) as CatalogFont[];
    return raw.map(({ id, family, category, weights, styles, subsets }) => ({ id, family, category, weights, styles, subsets })).sort((a, b) => a.family.localeCompare(b.family));
  })();
  catalogLoad.catch(() => (catalogLoad = null));
  return catalogLoad;
}

/** Families the design can always use without downloading. */
export const BUILT_IN = ['Inter'];

/** Popular families, a good first pick for agents. */
export const SUGGESTED: Record<string, string[]> = {
  'sans-serif': ['Inter', 'Montserrat', 'Poppins', 'Roboto', 'Open Sans', 'Lato', 'DM Sans', 'Work Sans', 'Manrope', 'Outfit'],
  serif: ['Playfair Display', 'Lora', 'Merriweather', 'DM Serif Display', 'Libre Baskerville', 'Cormorant Garamond', 'EB Garamond'],
  display: ['Anton', 'Bebas Neue', 'Oswald', 'Archivo Black', 'Abril Fatface', 'Righteous', 'Bungee', 'Alfa Slab One'],
  handwriting: ['Pacifico', 'Dancing Script', 'Caveat', 'Great Vibes', 'Satisfy', 'Kalam', 'Permanent Marker'],
  monospace: ['JetBrains Mono', 'Space Mono', 'IBM Plex Mono', 'Fira Code'],
};

export async function searchFonts(query: string, category?: string, limit = 30): Promise<CatalogFont[]> {
  const cat = await catalog();
  const q = query.trim().toLowerCase();
  let list = cat.filter((f) => (!category || f.category === category) && (!q || f.family.toLowerCase().includes(q)));
  if (!q) {
    const popular = new Set(Object.values(SUGGESTED).flat());
    list = [...list].sort((a, b) => Number(popular.has(b.family)) - Number(popular.has(a.family)));
  }
  return list.slice(0, limit);
}

interface FontDetail {
  unicodeRange: Record<string, string>;
  variants: Record<string, Record<string, Record<string, { url: { ttf?: string } }>>>;
}

function inRanges(ranges: string, cp: number): boolean {
  for (const part of ranges.split(',')) {
    const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m) continue;
    const lo = parseInt(m[1]!.replace(/\?/g, '0'), 16), hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1]!.replace(/\?/g, 'F'), 16);
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

const closest = (have: number[], want: number) => [...have].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || b - a)[0]!;

export interface FontFile { family: string; bytes: Uint8Array; weight: number; italic: boolean; subset: string; source: string }

const faceCache = new Map<string, Promise<Uint8Array | null>>();

/** Regular + bold, upright + italic, Latin + the scripts `text` uses. */
export async function fetchFamily(f: CatalogFont, text: string): Promise<FontFile[]> {
  const r = await fetch(`${API}/${f.id}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${f.family}: HTTP ${r.status}`);
  const d = (await r.json()) as FontDetail;
  const cps = new Set([...text].map((c) => c.codePointAt(0)!).filter((c) => c > 0x7f));
  const subsets = Object.keys(d.unicodeRange).filter((s) => s === 'latin' || [...cps].some((cp) => inRanges(d.unicodeRange[s]!, cp)));
  if (!subsets.length) subsets.push(Object.keys(d.unicodeRange)[0]!);
  const weights = [...new Set([closest(f.weights, 400), closest(f.weights, 700)])];
  const jobs: Promise<FontFile | null>[] = [];
  for (const w of weights) for (const style of f.styles.filter((s) => s === 'normal' || s === 'italic')) for (const sub of subsets) {
    const url = d.variants[String(w)]?.[style]?.[sub]?.url.ttf;
    if (!url) continue;
    if (!faceCache.has(url)) {
      const p = fetch(url, { signal: AbortSignal.timeout(20000) }).then(async (res) => (res.ok ? new Uint8Array(await res.arrayBuffer()) : null)).catch(() => null);
      faceCache.set(url, p);
      p.then((b) => { if (!b) faceCache.delete(url); });
    }
    jobs.push(faceCache.get(url)!.then((bytes) => (bytes ? { family: f.family, bytes, weight: w, italic: style === 'italic', subset: sub, source: `fontsource:${f.id}` } : null)));
  }
  const files = (await Promise.all(jobs)).filter((x): x is FontFile => !!x);
  if (!files.length) throw new Error(`${f.family}: no downloadable faces`);
  return files;
}

/** Every family the pages' text, tables and charts use. */
export function familiesIn(pages: readonly Page[]): Set<string> {
  const need = new Set<string>();
  for (const p of pages) for (const e of walk(p.elements)) {
    if (e.type === 'text') { need.add(e.style.fontFamily); for (const r of e.runs ?? []) if (r.style?.fontFamily) need.add(r.style.fontFamily); }
    if (e.type === 'table' || e.type === 'chart') need.add(e.style.fontFamily);
  }
  return need;
}

const textIn = (doc: Doc) => doc.pages.flatMap((p) => [...walk(p.elements)]).map((e) => (e.type === 'text' ? e.text : e.type === 'table' ? e.cells.flat().map((c) => c.text).join(' ') : '')).join(' ');

/**
 * Embed the faces of every family the design uses but doesn't carry yet.
 * Returns the families that could not be found (they draw as Inter).
 */
export async function embedFonts(file: ProjectFile): Promise<{ added: string[]; missing: string[] }> {
  const doc = file.doc;
  const have = new Set([...BUILT_IN, ...(doc.fonts ?? []).map((f) => f.family)]);
  const want = [...familiesIn(doc.pages)].filter((f) => !have.has(f));
  if (!want.length) return { added: [], missing: [] };
  let cat: CatalogFont[] = [];
  try { cat = await catalog(); } catch { return { added: [], missing: want }; }
  const sample = textIn(doc);
  const added: string[] = [], missing: string[] = [];
  const fonts: EmbeddedFont[] = [...(doc.fonts ?? [])];
  const assets = { ...doc.assets };
  for (const fam of want) {
    const f = cat.find((c) => c.family.toLowerCase() === fam.toLowerCase());
    if (!f) { missing.push(fam); continue; }
    try {
      for (const face of await fetchFamily(f, sample)) {
        const id = await assetId(face.bytes, 'font/ttf');
        file.assets.set(id, face.bytes);
        assets[id] = { mime: 'font/ttf', name: `${face.family} ${face.weight}${face.italic ? ' italic' : ''} (${face.subset})` };
        fonts.push({ family: f.family, asset: id, weight: face.weight, italic: face.italic, subset: face.subset, source: face.source });
      }
      added.push(f.family);
    } catch { missing.push(fam); }
  }
  file.doc = { ...doc, assets, fonts };
  return { added, missing };
}
